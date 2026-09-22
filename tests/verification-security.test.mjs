import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const portal=fs.readFileSync(new URL("../public/portal/index.html",import.meta.url),"utf8");
const security=fs.readFileSync(new URL("../src/verification-security.js",import.meta.url),"utf8");

test("address-based verification remains supported",()=>{
  assert.match(worker,/const addressComplete=Boolean\(personaFields\.address_street_1&&personaFields\.address_city&&personaFields\.address_subdivision&&personaFields\.address_postal_code\)/);
});

test("ID fallback works without address and requires identity details",()=>{
  assert.match(worker,/const idFallbackComplete=Boolean\(personaFields\.name_first&&personaFields\.name_last&&personaFields\.birthdate&&savedIdNumber&&sensitive\?\.issuing_state\)/);
  assert.match(worker,/Complete either the address or the DL\/State ID fallback/);
});

test("invalid Persona credentials produce a distinct state",()=>{
  assert.match(worker,/state==="invalid_credentials"\?401/);
  assert.match(portal,/Invalid credentials/);
});

test("wrong inquiry template is rejected",()=>{
  assert.match(worker,/PERSONA_INQUIRY_TEMPLATE_ID must be a Persona Inquiry Template ID beginning with itmpl_/);
  assert.match(worker,/incorrect_inquiry_template/);
  const personaVerifyRoute=worker.slice(worker.indexOf('url.pathname === "/api/admin/clients/persona-verify"'),worker.indexOf('url.pathname === "/api/admin/clients/persona-refresh"'));
  assert.match(personaVerifyRoute,/api\/v1\/inquiries/);
  assert.doesNotMatch(personaVerifyRoute,/api\/v1\/transactions/);
});

test("Sandbox validates credentials without reading protected template resources",()=>{
  assert.match(worker,/\^persona_sandbox_/);
  assert.match(worker,/api\/v1\/inquiries\?page%5Bsize%5D=1/);
  assert.match(worker,/Connected \(Sandbox\)/);
  assert.match(portal,/result\.message\|\|/);
});

test("birthdate supports numeric keypad entry while APIs receive ISO format",()=>{
  assert.match(portal,/client-persona-birthdate" type="text" inputmode="numeric"/);
  assert.match(portal,/placeholder="MM\/DD\/YYYY"/);
  assert.match(portal,/const formatBirthdateInput/);
  assert.match(portal,/const birthdateInputToIso/);
  assert.match(portal,/birthdate:birthdateInputToIso\(section\.querySelector\("\.client-persona-birthdate"\)\?\.value\)/);
});

test("duplicate Persona submissions are blocked",()=>{
  assert.match(worker,/persona_already_pending/);
  assert.match(worker,/A Persona verification is already pending for this client/);
});

test("Persona refresh updates latest status without changing manual decision",()=>{
  assert.match(worker,/\/api\/admin\/clients\/persona-refresh/);
  assert.match(worker,/UPDATE client_verification_audits SET persona_transaction_status=/);
  assert.doesNotMatch(worker,/persona-refresh[\s\S]{0,3000}SET identity_confirmed=/);
});

test("stale verification records are rejected",()=>{
  assert.match(worker,/verification_record_changed/);
  assert.match(worker,/expected_updated_at/);
});

test("ID numbers are encrypted and masked",()=>{
  assert.match(worker,/encryptVerificationField\(env,enteredIdNumber\)/);
  assert.match(worker,/idLast4=enteredIdNumber/);
  assert.match(worker,/safeVerificationSensitiveRecord/);
  assert.match(portal,/never shown in full again/);
});

test("sensitive verification deletion preserves audit history",()=>{
  assert.match(worker,/clearSensitiveVerificationData/);
  assert.match(worker,/DELETE FROM client_verification_sensitive_fields/);
  assert.doesNotMatch(worker,/DELETE FROM client_verification_audits WHERE client_id/);
  assert.match(worker,/Non-sensitive verification audit history retained/);
});

test("Persona result stays separate from manual final decision",()=>{
  assert.match(portal,/Persona does not automatically approve or decline a client/);
  assert.match(worker,/SET persona_transaction_id=/);
  assert.doesNotMatch(worker,/SET persona_transaction_id=[\s\S]{0,500}verification_status='verified'/);
});

test("retention auto-delete requires explicit policy and date",()=>{
  assert.match(worker,/Choose an explicit retention policy and scheduled deletion date before enabling automatic deletion/);
  assert.match(worker,/runVerificationRetention/);
});

test("verification permissions and fresh-session checks are enforced",()=>{
  assert.match(security,/view_id_images/);
  assert.match(security,/delete_sensitive/);
  assert.match(security,/reauth_required/);
  assert.match(worker,/verificationForbidden/);
});

test("Persona request rate limits and timeout states exist",()=>{
  assert.match(worker,/enforceVerificationRateLimit\(env,"persona_verify"/);
  assert.match(worker,/personaFetchState/);
  assert.match(worker,/refresh_recommended:true/);
});

test("Persona attempts and webhook health are retained",()=>{
  assert.match(worker,/CREATE TABLE IF NOT EXISTS persona_verification_attempts/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS persona_webhook_health/);
  assert.match(portal,/Webhook · Last received/);
});

test("audit activity sanitizes details and is append-only",()=>{
  assert.match(worker,/sanitizeVerificationActivity\(details/);
  assert.match(worker,/INSERT INTO client_verification_activity/);
  assert.doesNotMatch(worker,/DELETE FROM client_verification_activity/);
  assert.doesNotMatch(worker,/UPDATE client_verification_activity SET/);
});


test("Database verification result is returned to the dashboard",()=>{
  assert.match(worker,/persona_database_status/);
  assert.match(worker,/persona_database_verification_id/);
  assert.match(worker,/persona_database_checked_at/);
  assert.match(portal,/Database \(US\):/);
});


test("pending inquiry plus passed database is not Persona Pending",()=>{
  const match=worker.match(/function isPersonaDatabasePending\(transactionId,inquiryStatus,databaseStatus\) \{[\s\S]*?\n\}/);
  assert.ok(match,"isPersonaDatabasePending helper should exist");
  const isPersonaDatabasePending=new Function(match[0]+"; return isPersonaDatabasePending;")();
  assert.equal(isPersonaDatabasePending("inq_test","pending","passed"),false);
  assert.equal(isPersonaDatabasePending("inq_test","pending",""),true);
});

test("Persona workflow result endpoint requires run_persona permission",()=>{
  assert.match(worker,/\["\/api\/admin\/clients\/persona-workflow-result", "run_persona"\]/);
});

test("Persona Pending dashboard filter uses computed database-aware state",()=>{
  assert.match(portal,/verificationFilter === "persona_pending" && !verification\.persona_pending/);
  assert.match(portal,/Persona: Database Passed/);
});


test("Persona database persistence is tied to the current inquiry",()=>{
  assert.match(worker,/WHERE id=\? AND persona_transaction_id=\?/);
  assert.match(worker,/stale_persona_result/);
});

test("passed database creates a dedicated audit event once",()=>{
  assert.match(worker,/persona_database_passed/);
  assert.match(worker,/Persona Database \(US\) passed/);
});

test("stale Persona webhooks cannot overwrite a newer inquiry",()=>{
  assert.match(worker,/stale_persona_inquiry/);
  assert.match(worker,/Older Persona webhook ignored/);
});

test("Persona workflow exposes delayed database state",()=>{
  assert.match(worker,/database_delayed:Boolean\(!latestDatabase&&inquiryCreatedMs&&Date\.now\(\)-inquiryCreatedMs>60000\)/);
  assert.match(portal,/Database verification is taking longer than expected/);
});

test("new Persona inquiry auto-checks workflow and resets previous result",()=>{
  assert.match(portal,/Awaiting Database \(US\)…/);
  assert.match(portal,/\[2500,7500,15000\]\.forEach/);
});

test("Refresh Persona Status also refreshes Database US",()=>{
  assert.match(portal,/Inquiry refreshed\. Checking Database \(US\)…/);
  assert.match(portal,/workflowButton\.click\(\)/);
});

test("successful workflow card stays concise and IDs remain technical",()=>{
  assert.match(portal,/Database \(US\): \"\+escapeHtml\(statusLabel\)/);
  assert.match(portal,/Event ID: \"\+result\.trigger_event\?\.id/);
  assert.match(portal,/Verification ID: \"\+result\.database_verification\?\.id/);
});

test("database-only Persona end-to-end state keeps manual decision separate",()=>{
  const pendingMatch=worker.match(/function isPersonaDatabasePending\(transactionId,inquiryStatus,databaseStatus\) \{[\s\S]*?\n\}/);
  assert.ok(pendingMatch);
  const pending=new Function(pendingMatch[0]+"; return isPersonaDatabasePending;")();
  assert.equal(pending("inq_new","pending","passed"),false);
  assert.match(portal,/Manual: /);
  assert.match(portal,/Persona: Database Passed/);
});
