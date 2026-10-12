// Preview-only priority policy. No database writes, holds, emails, or booking mutations.
export const BOOKING_PRIORITY_POLICY = Object.freeze({
  mode: "longest_first",
  unverified_hold_minutes: 30,
  returning_verified_tiebreak: true,
  manual_screening_required: true,
});
const FINAL_STATES = new Set(["approved", "confirmed", "booked", "completed"]);
const CLOSED_STATES = new Set(["declined", "canceled", "cancelled", "expired"]);
const minutes = v => Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0;
const ms = v => { const n=Date.parse(String(v||"")); return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY; };
export function isConfirmedBooking(item) {
  return Boolean(item && (item.confirmed === true || FINAL_STATES.has(String(item.status||"").toLowerCase())));
}
export function isActiveInquiry(item) {
  return Boolean(item && !isConfirmedBooking(item) && !CLOSED_STATES.has(String(item.status||"").toLowerCase()));
}
export function priorityCompare(a,b) {
  const duration = minutes(b.duration_minutes)-minutes(a.duration_minutes);
  if(duration) return duration;
  const returning = Number(Boolean(b.returning_verified))-Number(Boolean(a.returning_verified));
  if(returning) return returning;
  const arrival = ms(a.created_at)-ms(b.created_at);
  if(arrival) return arrival;
  return String(a.id??"").localeCompare(String(b.id??""),undefined,{numeric:true});
}
export function rankBookingInquiries(items) {
  if(!Array.isArray(items)) throw new TypeError("Expected an array");
  return items.filter(isActiveInquiry).slice().sort(priorityCompare).map((item,index)=>({...item,priority_rank:index+1}));
}
// A hold is only allowed after explicit authorization. It never modifies confirmed reservations.
export function proposedHoldExpiresAt({authorized=false, verified=false, now=Date.now(), conflictWithConfirmed=false}={}) {
  if(!authorized || verified || conflictWithConfirmed || !Number.isFinite(now)) return null;
  return new Date(now+BOOKING_PRIORITY_POLICY.unverified_hold_minutes*60_000).toISOString();
}
export function activeProvisionalHold(hold, now=Date.now()) {
  if(!hold || hold.authorized!==true || hold.cancelled===true || hold.confirmed===true) return false;
  const until=Date.parse(String(hold.expires_at||""));
  return Number.isFinite(until) && until>now;
}
