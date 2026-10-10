// Booking-only email gate. Never send screening/ID/confirmation messages from this workflow.
import { appointmentUtcMs } from "./location-email-scheduler.js";

export async function ensureBookingEmailLedger(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS booking_email_delivery (
    request_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    delivery_key TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    provider_id TEXT,
    PRIMARY KEY (request_id,email_type,delivery_key)
  )`).run();
}

export function screeningReady(row) {
  return !!row && row.blacklist_status === "clear" && row.phone_status === "non_voip" &&
    row.identity_status === "supported" && row.background_status === "reviewed" &&
    row.decision === "move_forward";
}
export function screeningLabel(row, closed=false) {
  if(closed || row?.decision==="decline") return "Declined";
  if(screeningReady(row)) return "Screening approved";
  if(row?.decision==="needs_information") return "Needs information";
  return "Review required";
}
export async function sendDepositRequestEmail(env, requestId) {
  const row=await env.DB.prepare(`SELECT dr.id,dr.client_id,dr.status,dr.deposit_paid,dr.deposit_amount,
    dr.requested_date,dr.requested_time,dr.location_name,dr.notes,c.first_name,c.email,c.phone,
    sc.blacklist_status,sc.phone_status,sc.identity_status,sc.background_status,sc.decision
    FROM date_requests dr JOIN clients c ON c.id=dr.client_id
    LEFT JOIN client_screening_checklists sc ON sc.date_request_id=dr.id
    WHERE dr.id=? LIMIT 1`).bind(requestId).first();
  if(!row || !screeningReady(row)) return {status:"blocked",message:"Screening approval is required."};
  if(!["screening_pending","pending_final_approval"].includes(row.status) || Number(row.deposit_paid))return {status:"blocked",message:"This request is not awaiting a deposit."};
  if(!row.email || Number(row.deposit_amount)<=0)return {status:"blocked",message:"An email and calculated deposit amount are required."};
  const bad=await env.DB.prepare("SELECT id FROM blacklist WHERE client_id=? OR (email<>'' AND LOWER(email)=LOWER(?)) OR (phone<>'' AND phone=?) LIMIT 1").bind(row.client_id,row.email,row.phone||"").first();
  if(bad)return {status:"blocked",message:"Client is blacklisted."};
  const scheduled=appointmentUtcMs(row.requested_date,row.requested_time);
  if(!Number.isFinite(scheduled) || scheduled-Date.now()<4*3600000)return {status:"blocked",message:"Appointment is too soon or date is invalid."};
  if(!env.RESEND_API_KEY)return {status:"unavailable",message:"RESEND_API_KEY is not configured."};
  await ensureBookingEmailLedger(env);
  const claim=await env.DB.prepare("INSERT INTO booking_email_delivery(request_id,email_type,delivery_key,status) VALUES (?,'deposit_request','initial','sending') ON CONFLICT DO NOTHING").bind(row.id).run();
  if(Number(claim.meta?.changes||0)!==1)return {status:"already_claimed",message:"Deposit email previously sent or attempted; check delivery before retrying."};
  const money=value=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
  const notes=String(row.notes||"");
  const noteValue=key=>notes.match(new RegExp("^"+key+":\\s*([^\\n]+)","im"))?.[1]?.trim()||"";
  const itinerary=noteValue("Introduction itinerary").split("|").map(v=>v.trim());
  const experience=itinerary[0]&&!/undecided/i.test(itinerary[0])?itinerary[0]:(noteValue("Date type")||"Selected experience");
  const duration=itinerary[1]&&!/undecided/i.test(itinerary[1])?itinerary[1]:(noteValue("Duration")||"See request");
  const locationKey=String(row.location_name||itinerary[2]||noteValue("Location")).toLowerCase();
  const location=locationKey.includes("outcall")?"Outcall — Kendra visits my location":
    locationKey.includes("incall")?"Incall — I'll visit Kendra at her location":"To be confirmed";
  const method=noteValue("Deposit payment method")||noteValue("Deposit preference");
  const cashApp=/^cash[ -]?app$/i.test(method);
  // A completed payment-method step already stores the fee-inclusive amount.
  const includesFee=!!noteValue("Deposit payment method") && cashApp;
  const baseDeposit=Math.round((includesFee?Number(row.deposit_amount)/1.1:Number(row.deposit_amount))*100)/100;
  const fee=cashApp?Math.round(baseDeposit*0.1*100)/100:0;
  const due=Math.round((baseDeposit+fee)*100)/100;
  const baseRate=Math.round(baseDeposit*4*100)/100;
  const balance=Math.round((baseRate-baseDeposit)*100)/100;
  const body=["Hey "+(row.first_name||"handsome")+",","",
    "I've had a chance to look over your introduction, and I'd love for us to move forward.","",
    "OUR LITTLE ITINERARY",
    "Experience: "+experience,
    "Time together: "+duration,
    "Meeting preference: "+location,
    "Preferred date: "+row.requested_date,
    "Preferred time: "+row.requested_time+" (Los Angeles time)","",
    "THE LITTLE DETAILS",
    "Base experience rate: "+money(baseRate),
    "Deposit (25% of base rate): "+money(baseDeposit),
    ...(cashApp?["Cash App processing fee (10% of deposit): "+money(fee)]:[]),
    "Deposit due now: "+money(due),
    "Remaining experience balance: "+money(balance),
    ...(method?["Selected deposit method: "+method]:[]),"",
    "Please reply to arrange the deposit using your selected payment method.",
    "Payment is not confirmed until I verify receipt. Your appointment and location are not confirmed until final approval.",
    "I'll send the location details two hours before our appointment once everything is confirmed.","",
    "Looking forward to seeing you, handsome. 💋","Xoxo,","Kendra 💕"].join("\n");
  try{
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"kendra-deposit-"+row.id},
      body:JSON.stringify({from:"Kendra Bexly <hello@kendrabexly.com>",reply_to:"kendrabexly@gmail.com",to:[row.email],subject:"Your deposit details",text:body})
    });
    if(!response.ok){console.error("Deposit delivery failed",row.id,response.status);return {status:"delivery_unconfirmed",message:"Email delivery failed; check provider before retrying."};}
    const data=await response.json().catch(()=>({}));
    await env.DB.prepare("UPDATE booking_email_delivery SET status='sent',sent_at=CURRENT_TIMESTAMP,provider_id=? WHERE request_id=? AND email_type='deposit_request' AND delivery_key='initial'").bind(String(data.id||""),row.id).run();
    await env.DB.prepare("INSERT INTO email_drafts(client_id,date_request_id,email_type,subject,body,status,sent_at) VALUES (?,?, 'deposit_request',?,?, 'sent',CURRENT_TIMESTAMP)").bind(row.client_id,row.id,"Your deposit details",body).run();
    return {status:"sent",message:"Deposit email sent."};
  }catch(error){console.error("Deposit email exception",row.id,error);return {status:"delivery_unconfirmed",message:"Email delivery could not be confirmed; check provider before retrying."};}
}
