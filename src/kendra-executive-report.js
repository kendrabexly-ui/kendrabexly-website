// Privacy-preserving Kendra -> Chief of Staff reporting contract.
// No client-level information may cross this boundary.
const KEYS=["report_date","inquiries_new","tasks_open","tasks_done","alerts_open","portal_healthy"];
const counts=["inquiries_new","tasks_open","tasks_done","alerts_open"];
export function sanitizeExecutiveReport(raw) {
  if(!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("Invalid report");
  const out={project:"kendra",schema_version:1};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.report_date||"")))throw new Error("Invalid date");
  out.report_date=raw.report_date;
  for(const key of counts) {
    const v=raw[key];
    if(!Number.isSafeInteger(v)||v<0||v>1000000)throw new Error("Invalid "+key);
    out[key]=v;
  }
  if(typeof raw.portal_healthy!=="boolean")throw new Error("Invalid health");
  out.portal_healthy=raw.portal_healthy;
  return out; // Never spread raw or include IDs, contact data, notes, screening, location.
}
const enc=new TextEncoder();
const bytes=buf=>Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join("");
export async function signReport(report,secret,timestamp,nonce){
  if(typeof secret!=="string"||secret.length<32)throw new Error("Missing secure secret");
  const body=JSON.stringify(sanitizeExecutiveReport(report));
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return {body,timestamp:String(timestamp),nonce,signature:bytes(await crypto.subtle.sign("HMAC",key,enc.encode(timestamp+"."+nonce+"."+body)))};
}
export async function verifyReport(envelope,secret,now=Date.now()){
  if(!envelope||typeof envelope!=="object"||!/^\d{13}$/.test(String(envelope.timestamp||""))||! /^[a-f0-9-]{36}$/i.test(String(envelope.nonce||"")))return false;
  if(Math.abs(now-Number(envelope.timestamp))>300000)return false;
  if(typeof envelope.body!=="string"||envelope.body.length>2000||! /^[a-f0-9]{64}$/.test(String(envelope.signature||"")))return false;
  let parsed;try{parsed=JSON.parse(envelope.body)}catch{return false}
  if(JSON.stringify(sanitizeExecutiveReport(parsed))!==envelope.body)return false;
  const valid=await signReport(parsed,secret,envelope.timestamp,envelope.nonce);
  const a=enc.encode(valid.signature),b=enc.encode(envelope.signature);
  return a.length===b.length&&a.reduce((n,v,i)=>n|(v^b[i]),0)===0;
}
// Best effort, never propagated into critical bookings.
export async function deliverReport(send,report,secret,now=Date.now(),nonce=crypto.randomUUID()){
  try{const envelope=await signReport(report,secret,now,nonce);const response=await send(envelope);return {delivered:Boolean(response?.ok)}}
  catch{return {delivered:false}}
}
