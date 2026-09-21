import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const portal = readFileSync(new URL("../public/portal/index.html", import.meta.url), "utf8");

test("Persona lifecycle routes cover test, refresh, retry, and webhook delivery", () => {
  for (const route of ["persona-test", "persona-refresh", "persona-verify", "/api/webhooks/persona"]) {
    assert.match(worker, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const status of ["approved", "declined", "errored", "failed", "created", "pending", "needs_review"]) {
    assert.ok(worker.includes(`"${status}"`), `missing Persona state ${status}`);
  }
});

test("Persona updates remain separate from the final manual decision", () => {
  const webhookBlock = worker.slice(worker.indexOf("IDENTITY VERIFICATION WEBHOOK"), worker.indexOf("EMAIL ENGAGEMENT WEBHOOK"));
  assert.doesNotMatch(webhookBlock, /SET\s+verification_status\s*=/i);
  assert.doesNotMatch(webhookBlock, /identity_confirmed\s*=\s*CASE/i);
  assert.match(portal, /Persona does not automatically approve or decline a client/);
});

test("Webhook events are idempotent and unmatched events are flagged", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS persona_webhook_events/);
  assert.match(worker, /duplicate:true/);
  assert.match(worker, /processing_status='unmatched'/);
  assert.match(worker, /code:"invalid_signature"/);
});

test("Persona validation covers DOB, contact data, address parsing, and duplicate submissions", () => {
  assert.match(worker, /missingRequired/);
  assert.match(worker, /verificationEmailValid/);
  assert.match(worker, /normalizeVerificationPhone/);
  for (const unitToken of ["APT", "APARTMENT", "UNIT", "SUITE", "STE", "#"]) assert.ok(worker.includes(unitToken));
  assert.match(worker, /persona_already_pending/);
  assert.match(worker, /persona_retry_required/);
});

test("Dashboard exposes accessible controls, result details, exports, retention, and queue filters", () => {
  for (const text of [
    "Test Persona Connection", "Refresh Persona Status", "Export CSV", "Export PDF",
    "Retention due", "Action Required", "Ready for Final Decision", "Flagged"
  ]) assert.ok(portal.includes(text), `missing dashboard control: ${text}`);
  assert.match(portal, /aria-live="polite"/);
  assert.match(portal, /role="alert"/);
  assert.match(portal, /localStorage\.setItem\("verificationQueueFilter"/);
});

test("Verification exports explicitly exclude the stored ID image", () => {
  assert.match(worker, /This report excludes the stored ID image/);
  const exportBlock = worker.slice(worker.indexOf("verification-export"), worker.indexOf("persona-verify"));
  assert.doesNotMatch(exportBlock, /object_key|ID_DOCUMENTS\.get/);
});

test("ID-number address fallback is encrypted, masked, and schema-gated", () => {
  assert.match(worker, /AES-GCM/);
  assert.match(worker, /VERIFICATION_FIELD_ENCRYPTION_KEY/);
  assert.match(worker, /id_number_ciphertext/);
  assert.match(worker, /number_masked/);
  assert.match(worker, /supportedFields\.has\("identification_number"\)/);
  assert.match(worker, /Address unavailable—ID details used instead/);
  assert.doesNotMatch(worker, /id_details:\{[^}]*number:row\?\.id_number_ciphertext/s);
});

test("Address fallback requires name, DOB, ID number, and issuing state", () => {
  for (const field of ["name_first","name_last","birthdate","identification_number","identification_issuing_subdivision"]) {
    assert.ok(worker.includes(`"${field}"`), `missing fallback field ${field}`);
  }
  assert.match(portal, /DL\/State ID Number/);
  assert.match(portal, /Issuing State/);
  assert.match(portal, /Expiration Date/);
  assert.match(portal, /Address unavailable—ID details used instead/);
});
