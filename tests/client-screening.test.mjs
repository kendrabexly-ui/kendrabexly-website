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
test("portal has manual screening button and report panel",()=>{
  assert.match(portal,/class="run-client-screening"/);
  assert.match(portal,/class="client-screening-report"/);
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
  assert.equal(calls.some(sql=>/UPDATE\s+date_requests|UPDATE\s+clients/i.test(sql)),false);
});
