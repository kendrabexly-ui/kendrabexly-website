import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInitialScreening } from "../src/client-screening.js";

const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const portal=readFileSync(new URL("../public/portal/index.html",import.meta.url),"utf8");
test("automatic request screening is wired after request creation",()=>{
  assert.match(source,/runInitialScreening\(env, requestId, "automatic"\)/);
});
test("manual screening endpoint is permission protected",()=>{
  assert.match(source,/\["\/api\/admin\/clients\/run-screening", "edit_verification"\]/);
  assert.match(source,/runInitialScreening\(env,id,"manual"\)/);
});
test("portal consolidates screening into one review panel",()=>{
  assert.match(portal,/Client screening · One review/);
  assert.match(portal,/class="unified-submitted-grid"/);
  assert.match(portal,/data-check-note="summary"/);
  assert.match(portal,/Approve · Send deposit request/);
  assert.match(portal,/class="screening-checklist-save"/);
});
test("screening does not mutate final approval",async()=>{
  const calls=[];
  const rows=[
    {request_id:3,client_id:4,first_name:"Test",last_name:"Client",email:"test@example.com",phone:"(213) 555-0100",notes:"Occupation: Designer"},
    {id:null},{count:1}
  ];
  const env={DB:{prepare(sql){calls.push(sql);return {bind(){return this;},async first(){return rows.shift();},async run(){return {success:true};}};}}};
  const report=await runInitialScreening(env,3,"manual");
  assert.equal(report.recommendation,"manual_review_required");
  assert.equal(report.final_approval,"unchanged");
  assert.equal(report.email.ownership,"not_verified");
  assert.equal(report.occupation.employer,"not_verified");
  assert.equal(report.phone.twilio.status,"not_configured");
  for (const key of ["id_records","professional_licenses","professional_credentials","public_records","criminal_records","court_and_docket_indexes"]) {
    assert.equal(report.external_sources[key].status,"not_checked", key);
  }
  assert.equal(calls.some(sql=>/UPDATE\s+date_requests|UPDATE\s+clients/i.test(sql)),false);
});

test("Move Forward and deposit endpoints enforce the saved screening decision",()=>{
  assert.match(source,/async function requireScreeningMoveForward\(env,requestId\)/);
  const move=source.indexOf('url.pathname === "/api/admin/request/move-forward"');
  const deposit=source.indexOf('url.pathname === "/api/admin/request/request-deposit"');
  assert.ok(move>0&&deposit>move);
  assert.match(source.slice(move,move+1100),/requireScreeningMoveForward\(env,requestId\)/);
  assert.match(source.slice(deposit,deposit+950),/sendDepositRequestEmail\(env,requestId\)/);
  for(const status of ['blacklist_status==="clear"','phone_status==="non_voip"','identity_status==="supported"','background_status==="reviewed"','decision==="move_forward"']){
    assert.ok(source.includes(status),status);
  }
});
