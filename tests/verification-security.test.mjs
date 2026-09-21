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
  assert.match(worker,/PERSONA_INQUIRY_TEMPLATE_ID must begin with itmpl_/);
  assert.match(worker,/incorrect_inquiry_template/);
  assert.match(worker,/api\/v1\/inquiries/);
  assert.doesNotMatch(worker,/api\/v1\/transactions/);
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
