import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const from = source.indexOf("function standaloneBookingPage()");
assert.ok(from > 0, "Booking page function exists");
const to = source.indexOf("\nfunction ", from + 20);
const booking = source.slice(from, from + 50000);

test("introduction still posts to the existing secured request endpoint with screening-only flag", () => {
  assert.match(booking, /new FormData\(f\)/);
  assert.match(booking, /payload\.set\("screening_only","true"\)/);
  assert.match(booking, /fetch\("\/api\/request",\{method:"POST",body:payload\}\)/);
  assert.match(source, /validateIntroductionTermsAcceptance\(env\.DB, data\)/);
});
test("all required identity, photo and screening controls remain", () => {
  for (const name of ["first_name","last_name","age","occupation","base_state","phone","email","screening_method","intro_photo"]) {
    assert.ok(booking.includes('name="'+name+'"'), name+" remains");
  }
  assert.match(booking,/id="terms-accepted"[^>]*required disabled/);
  assert.match(booking,/name="intro_preferred_time"/);
  assert.match(source,/two hours away/);
});
test("location value and screening choices are unchanged while labels are clearer", () => {
  assert.match(booking,/data-field="intro-location" data-value="incall"[^>]*>[\s\S]*?Visit Kendra/);
  assert.match(booking,/data-field="intro-location" data-value="outcall"[^>]*>[\s\S]*?Have Kendra Visit You/);
  for (const v of ["government-id","linkedin","employment"]) assert.ok(booking.includes('value="'+v+'"'));
});
test("optional hospitality notes are bounded and retained on private request", () => {
  assert.match(booking,/name="intro_hospitality" maxlength="400"/);
  assert.match(source,/const introHospitality = String\(data\.intro_hospitality \|\| ""\)\.trim\(\)/);
  assert.match(source,/Personal touch: \$\{introHospitality \|\| "Not specified"\}/);
});
test("deposit choices and existing verification flow remain unchanged", () => {
  for (const value of ["cash-app","gift-card","crypto"]) assert.ok(booking.includes('value="'+value+'"'));
  assert.match(booking,/No payment is collected before screening approval/);
  assert.match(booking,/Once everything is confirmed, which deposit method would you prefer/);
});

test("simulated submission sends only a synthetic multipart request and redirects on success", async () => {
  // Execute the real browser submission callback, with network and FormData mocked.
  const match=booking.match(/f\.addEventListener\("submit",(async e=>\{[\s\S]*?\})\);\s*\}\)\(\)/);
  assert.ok(match,"submission callback is available");
  const calls=[];
  const status={className:""};
  const submit={disabled:false,textContent:"Introduce Myself"};
  const fakeForm={reportValidity(){return true}};
  const window={location:{assign(path){calls.push({redirect:path})}}};
  class MockFormData {
    constructor(form){assert.equal(form,fakeForm);this.values={intro_hospitality:"Soft jazz and water",intro_photo:{type:"image/png",size:24},intro_preferred_time:"16:30"};}
    set(k,v){this.values[k]=v;}
  }
  const fetch=async(path,options)=>{
    assert.equal(path,"/api/request");
    assert.equal(options.method,"POST");
    assert.equal(options.body.values.screening_only,"true");
    assert.equal(options.body.values.intro_hospitality,"Soft jazz and water");
    calls.push({submitted:true});
    return {ok:true,async json(){return {ok:true}}};
  };
  const message=()=>{throw Error("No error expected")};
  const callback=new Function("f","status","submit","FormData","fetch","window","message","return ("+match[1]+")")(fakeForm,status,submit,MockFormData,fetch,window,message);
  await callback({preventDefault(){}});
  assert.deepEqual(calls,[{submitted:true},{redirect:"/thank-you/"}]);
});
test("rejected submissions cannot redirect to thank-you",async()=>{
  const match=booking.match(/f\.addEventListener\("submit",(async e=>\{[\s\S]*?\})\);\s*\}\)\(\)/);
  assert.ok(match);
  const calls=[];
  const status={className:""};
  const submit={disabled:false,textContent:"Introduce Myself"};
  const form={reportValidity(){return true}};
  class MockFormData {set(){} constructor(){}}
  const fetch=async()=>({ok:false,async json(){return {ok:false,message:"Invalid screening data"}}});
  const window={location:{assign(){calls.push("redirect")}}};
  const message=(content,type)=>calls.push({content,type});
  const callback=new Function("f","status","submit","FormData","fetch","window","message","return ("+match[1]+")")(form,status,submit,MockFormData,fetch,window,message);
  await callback({preventDefault(){}});
  assert.deepEqual(calls,[{content:"Invalid screening data",type:"error"}]);
  assert.equal(submit.disabled,false);
});
test("server enforces photo signature, slot availability, secure terms and persists private request",()=>{
  assert.match(source,/introductionPhoto instanceof File/);
  assert.match(source,/introductionPhoto\.size>10\*1024\*1024/);
  assert.match(source,/Please select a valid photo image/);
  assert.match(source,/validateIntroductionTermsAcceptance\(env\.DB, data\)/);
  assert.match(source,/siteAvailableSlots\(env,introPreferredDate/);
  assert.match(source,/less than two hours away/);
  assert.match(source,/INSERT INTO date_requests/);
  assert.match(source,/Personal touch: \$\{introHospitality/);
  assert.match(source,/runInitialScreening\(env, requestId, "automatic"\)/);
});
