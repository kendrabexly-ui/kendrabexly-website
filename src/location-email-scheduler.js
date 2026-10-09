// Address delivery is intentionally separate from the public booking form.
// The appointment must be approved and the deposit confirmed before any address is released.
const ZONE = "America/Los_Angeles";
export function appointmentUtcMs(date, time) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date)) || !/^\\d{2}:\\d{2}/.test(String(time))) return NaN;
  const target = String(date)+"T"+String(time).slice(0,5);
  const naive = Date.parse(target+":00Z");
  if (!Number.isFinite(naive)) return NaN;
  const formatter = new Intl.DateTimeFormat("en-CA",{timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts = ms => Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  let guess = naive+7*3600000;
  for(let n=0;n<3;n++){const p=parts(guess);const observed=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);guess+=naive-observed;}
  const p=parts(guess);
  if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`!==target) return NaN;
  return guess;
}
export async function sendDueLocationEmails(env, now=Date.now()) {
  if (!env.DB || !env.RESEND_API_KEY) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS location_email_delivery (
    request_id INTEGER PRIMARY KEY,
    appointment_key TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  )`).run();
  // Only approved incall bookings with paid deposits and an actual saved address.
  const result=await env.DB.prepare(`SELECT dr.id,dr.requested_date,dr.requested_time,dr.location_address,
    c.email,c.first_name
    FROM date_requests dr JOIN clients c ON c.id=dr.client_id
    WHERE dr.status='approved' AND dr.deposit_paid=1
      AND TRIM(COALESCE(dr.location_address,''))<>'' AND TRIM(COALESCE(c.email,''))<>''`).all();
  for(const row of result.results||[]){
    const appointment=appointmentUtcMs(row.requested_date,row.requested_time);
    const due=appointment-2*3600000;
    if(!Number.isFinite(appointment)||now<due||now>=appointment)continue;
    const key=`${row.requested_date}T${row.requested_time}|${row.location_address}`;
    const previous=await env.DB.prepare("SELECT appointment_key,status FROM location_email_delivery WHERE request_id=?").bind(row.id).first();
    if(previous?.appointment_key===key)continue; // includes in-flight: never send twice
    const claim=await env.DB.prepare(`INSERT INTO location_email_delivery(request_id,appointment_key,status)
      VALUES (?,?,'sending') ON CONFLICT(request_id) DO UPDATE SET
      appointment_key=excluded.appointment_key,status='sending',claimed_at=CURRENT_TIMESTAMP,sent_at=NULL
      WHERE location_email_delivery.appointment_key<>excluded.appointment_key`).bind(row.id,key).run();
    if(!claim.meta?.changes)continue;
    // Recheck cancellation, reschedule and payment before release.
    const fresh=await env.DB.prepare("SELECT status,deposit_paid,requested_date,requested_time,location_address FROM date_requests WHERE id=?").bind(row.id).first();
    if(!fresh||fresh.status!=='approved'||Number(fresh.deposit_paid)!==1||`${fresh.requested_date}T${fresh.requested_time}|${fresh.location_address}`!==key){
      await env.DB.prepare("DELETE FROM location_email_delivery WHERE request_id=? AND appointment_key=? AND status='sending'").bind(row.id,key).run();
      continue;
    }
    const body=`Hi ${row.first_name||"there"},\\n\\nI'm looking forward to seeing you. Here are the details for our appointment:\\n\\nDate: ${row.requested_date}\\nTime: ${row.requested_time} (Los Angeles time)\\nAddress: ${row.location_address}\\n\\nSee you soon,\\nKendra`;
    try {
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({from:"Kendra Bexly <newsletter@kendrabexly.com>",reply_to:"kendrabexly@gmail.com",
          to:[row.email],subject:"Your appointment location",text:body,
          headers:{"Idempotency-Key":"location-"+row.id+"-"+encodeURIComponent(key).slice(0,120)}})
      });
      if(!response.ok){console.error("Location email delivery failed",row.id,response.status);continue;}
      await env.DB.prepare("UPDATE location_email_delivery SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE request_id=? AND appointment_key=?").bind(row.id,key).run();
    }catch(error){console.error("Location email delivery exception",row.id,error);}
    // Failed or ambiguous deliveries stay claimed for manual inspection to avoid duplicates.
  }
}
