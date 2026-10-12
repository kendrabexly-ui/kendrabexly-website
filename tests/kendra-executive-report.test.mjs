import test from "node:test";import assert from "node:assert/strict";
import {sanitizeExecutiveReport,signReport,verifyReport,deliverReport} from "../src/kendra-executive-report.js";
const sample={report_date:"2026-10-12",inquiries_new:3,tasks_open:2,tasks_done:5,alerts_open:1,portal_healthy:true,client_name:"Private",address:"Private",screening_details:"Private",photo:"Private"};
const secret="a-very-long-independent-service-authentication-key";
test("strict allowlist removes all client fields",()=>{const out=sanitizeExecutiveReport(sample);assert.equal(JSON.stringify(out).includes("Private"),false);assert.deepEqual(Object.keys(out).sort(),["project","schema_version","report_date","inquiries_new","tasks_open","tasks_done","alerts_open","portal_healthy"].sort());});
test("valid HMAC report passes and modifications fail",async()=>{const now=Date.parse("2026-10-12T12:00:00Z");const r=await signReport(sample,secret,now,"12345678-1234-4234-8234-123456789012");assert.equal(await verifyReport(r,secret,now),true);assert.equal(await verifyReport({...r,body:r.body.replace('"inquiries_new":3','"inquiries_new":8')},secret,now),false);assert.equal(await verifyReport(r,secret,now+300001),false);});
test("delivery failure never interrupts operations",async()=>{const r=await deliverReport(async()=>{throw Error("outage")},sample,secret);assert.deepEqual(r,{delivered:false});});
test("invalid counts rejected",()=>assert.throws(()=>sanitizeExecutiveReport({...sample,tasks_open:-1})));
