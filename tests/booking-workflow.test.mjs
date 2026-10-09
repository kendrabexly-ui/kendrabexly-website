import test from "node:test";
import assert from "node:assert/strict";
import { appointmentUtcMs, sendDueLocationEmails } from "../src/location-email-scheduler.js";
import { screeningReady, screeningLabel, sendDepositRequestEmail } from "../src/booking-email-flow.js";

const ready={blacklist_status:"clear",phone_status:"non_voip",identity_status:"supported",background_status:"reviewed",decision:"move_forward"};
test("Los Angeles appointment conversion handles daylight saving and rejects missing local times",()=>{
  assert.equal(appointmentUtcMs("2027-07-01","16:30"),Date.parse("2027-07-01T23:30:00Z"));
  assert.equal(appointmentUtcMs("2027-01-02","16:30"),Date.parse("2027-01-03T00:30:00Z"));
  assert.ok(Number.isNaN(appointmentUtcMs("2027-03-14","02:30")));
  assert.ok(Number.isNaN(appointmentUtcMs("invalid","16:30")));
});
test("screening approval requires all four checks and one positive decision",()=>{
  assert.equal(screeningReady(ready),true);
  assert.equal(screeningLabel(ready),"Screening approved");
  for(const [field,value] of [["blacklist_status","possible_match"],["phone_status","voip"],["identity_status","unverified"],["background_status","needs_follow_up"],["decision","pending"]]){
    assert.equal(screeningReady({...ready,[field]:value}),false,field);
  }
  assert.equal(screeningLabel({...ready,decision:"decline"}),"Declined");
});
test("deposit email is claimed once, references selected method and never marks payment",async()=>{
  const row={id:9,client_id:5,status:"pending_final_approval",deposit_paid:0,deposit_amount:125,
    requested_date:"2027-07-01",requested_time:"16:30",notes:"Deposit preference: cash-app",
    first_name:"Taylor",email:"example@example.com",phone:"2135550100",...ready};
  let claimed=false,deliveries=0,draftWrites=0;const originalFetch=globalThis.fetch;
  const DB={prepare(sql){const handle={args:[],bind(...args){this.args=args;return this;},
      async first(){if(sql.includes("FROM date_requests dr JOIN clients"))return row;if(sql.includes("FROM blacklist"))return null;return null;},
      async run(){if(sql.includes("INSERT INTO booking_email_delivery")){if(claimed)return {meta:{changes:0}};claimed=true;return {meta:{changes:1}};}
        if(sql.includes("INSERT INTO email_drafts"))draftWrites++;return {meta:{changes:1}};}
    };return handle;}};
  globalThis.fetch=async(url,options)=>{deliveries++;const data=JSON.parse(options.body);
    assert.match(data.text,/cash-app/);assert.match(data.text,/\$125\.00/);
    assert.doesNotMatch(data.text,/Address:/);assert.ok(options.headers["Idempotency-Key"]);
    return {ok:true,json:async()=>({id:"provider-id"})};};
  try{
    assert.equal((await sendDepositRequestEmail({DB,RESEND_API_KEY:"test"},row.id)).status,"sent");
    assert.equal((await sendDepositRequestEmail({DB,RESEND_API_KEY:"test"},row.id)).status,"already_claimed");
    assert.equal(deliveries,1);assert.equal(draftWrites,1);assert.equal(row.deposit_paid,0);
    row.decision="needs_information";
    assert.equal((await sendDepositRequestEmail({DB,RESEND_API_KEY:"test"},row.id)).status,"blocked");
    assert.equal(deliveries,1);
  }finally{globalThis.fetch=originalFetch;}
});
test("location email is sent only in two-hour window, once per appointment, after final approval",async()=>{
  const row={id:12,client_id:5,status:"approved",deposit_paid:1,final_approval:1,
    requested_date:"2027-07-01",requested_time:"16:30",location_address:"123 Example St, Los Angeles",
    email:"example@example.com",first_name:"Taylor",...ready};
  let key=null,deliveryCount=0,attemptCount=0;const originalFetch=globalThis.fetch;
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
      async all(){return {results:row.status==="approved"?[{...row}]:[]};},
      async first(){if(sql.startsWith("SELECT id FROM blacklist"))return null;
        if(sql.includes("FROM location_email_delivery"))return key?{appointment_key:key,status:"sent"}:null;
        if(sql.includes("FROM date_requests dr LEFT JOIN"))return {...row};
        return null;},
      async run(){if(sql.includes("INSERT INTO location_email_delivery")){key=this.args[1];attemptCount++;return {meta:{changes:1}};}
        return {meta:{changes:1}};}};}};
  globalThis.fetch=async(url,opts)=>{deliveryCount++;const data=JSON.parse(opts.body);
    assert.match(data.text,/123 Example St/);assert.ok(opts.headers["Idempotency-Key"]);
    return {ok:true,json:async()=>({id:"location-id"})};};
  const due=appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000;
  try{
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},due-1);
    assert.equal(deliveryCount,0);
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},due+30000);
    assert.equal(deliveryCount,1);
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},due+60000);
    assert.equal(deliveryCount,1);
    row.requested_date="2027-07-02";
    const due2=appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000;
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},due2+10000);
    assert.equal(deliveryCount,2);
    row.status="canceled";
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},due2+20000);
    assert.equal(deliveryCount,2);
    row.status="approved";row.deposit_paid=0;
    row.requested_date="2027-07-03";
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000+10000);
    assert.equal(deliveryCount,2);
    row.deposit_paid=1;row.final_approval=0;
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000+20000);
    assert.equal(deliveryCount,2);
    row.final_approval=1;row.decision="needs_information";
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000+30000);
    assert.equal(deliveryCount,2);
    row.decision="move_forward";
    await sendDueLocationEmails({DB,RESEND_API_KEY:"test"},appointmentUtcMs(row.requested_date,row.requested_time)-2*3600000+120000);
    assert.equal(deliveryCount,2,"missed send window must not release address late");
    assert.equal(attemptCount,2);
  }finally{globalThis.fetch=originalFetch;}
});
