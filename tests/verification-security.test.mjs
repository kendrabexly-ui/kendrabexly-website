import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const portal=fs.readFileSync(new URL("../public/portal/index.html",import.meta.url),"utf8");
const requestPage=fs.readFileSync(new URL("../public/request.html",import.meta.url),"utf8");
const continuationPage=fs.readFileSync(new URL("../public/complete/index.html",import.meta.url),"utf8");
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
  assert.match(portal,/result\.trigger_event\?\.id\?"Event ID: "\+result\.trigger_event\.id/);
  assert.match(portal,/result\.database_verification\?\.id\?"Verification ID: "\+result\.database_verification\.id/);
});

test("database-only Persona end-to-end state keeps manual decision separate",()=>{
  const pendingMatch=worker.match(/function isPersonaDatabasePending\(transactionId,inquiryStatus,databaseStatus\) \{[\s\S]*?\n\}/);
  assert.ok(pendingMatch);
  const pending=new Function(pendingMatch[0]+"; return isPersonaDatabasePending;")();
  assert.equal(pending("inq_new","pending","passed"),false);
  assert.match(portal,/Manual: /);
  assert.match(portal,/Persona: Database Passed/);
});


test("Persona section renders one status card and one technical details control",()=>{
  assert.doesNotMatch(portal,/client-persona-transaction-card/);
  assert.doesNotMatch(portal,/client-persona-transaction-details/);
  assert.match(portal,/class="client-persona-workflow-result"/);
  assert.match(portal,/class="client-persona-technical"/);
});

test("persisted Database Passed state uses the primary Persona result card",()=>{
  assert.match(portal,/Database \(US\): "\+escapeHtml\(databaseLabel\)/);
  assert.match(portal,/administrative Persona state/);
});


test("Persona readiness prioritizes Database Passed over pending inquiry",()=>{
  assert.match(portal,/if\(databaseStatus==="passed"\)return \{key:"database_passed",label:"Database Passed"/);
  assert.match(portal,/database_passed:"Database \(US\) passed/);
});

test("workflow result reloads persisted audit state before final Persona badge render",()=>{
  assert.match(portal,/await loadVerificationAudits\(section\);\n\s*renderPersonaReadiness\(section,section\.dataset\.personaConnected==="1"\);/);
});


test("phone line-type verification route is permission protected",()=>{
  assert.match(worker,/\["\/api\/admin\/clients\/phone-line-type", "edit_verification"\]/);
});

test("phone line-type verification uses Twilio Lookup Intelligence",()=>{
  assert.match(worker,/lookups\.twilio\.com\/v2\/PhoneNumbers/);
  assert.match(worker,/Fields=line_type_intelligence/);
  assert.match(worker,/fixedVoip/);
  assert.match(worker,/nonFixedVoip/);
});

test("VoIP phone numbers fail verification readiness",()=>{
  assert.match(portal,/VoIP phone number detected\. Use a non-VoIP number\./);
  assert.match(portal,/Phone valid \/ non-VoIP/);
  assert.match(portal,/client-phone-line-check/);
});

test("changing the phone invalidates the previous line-type result",()=>{
  assert.match(portal,/Phone changed · check again/);
  assert.match(portal,/phoneLineCheckedNumber="";/);
});


test("Persona readiness does not say Not ready after Database US already passed",()=>{
  assert.match(portal,/databaseAlreadyPassed\?"External check complete":allReady\?"Ready to submit":"Not ready to submit"/);
});


test("employment verification fields are persisted on the audit record",()=>{
  assert.match(worker,/employment_verification_status TEXT NOT NULL DEFAULT 'not_checked'/);
  assert.match(worker,/employment_verification_method TEXT NOT NULL DEFAULT ''/);
  assert.match(worker,/employment_work_email TEXT NOT NULL DEFAULT ''/);
  assert.match(worker,/employment_employer_website TEXT NOT NULL DEFAULT ''/);
  assert.match(worker,/employment_evidence_reference TEXT NOT NULL DEFAULT ''/);
});

test("employment verification requires evidence before Confirmed",()=>{
  assert.match(worker,/Employer, job title, industry, verification method, and evidence\/reference are required before employment can be marked Confirmed/);
  assert.match(worker,/Employment verification must be Confirmed before marking this client Verified/);
});

test("portal has structured employment verification workflow",()=>{
  assert.match(portal,/Employment verification .*<\/legend>/);
  assert.match(portal,/client-verification-employer/);
  assert.match(portal,/client-verification-job-title/);
  assert.match(portal,/client-employment-method/);
  assert.match(portal,/client-employment-status/);
  assert.match(portal,/client-employment-evidence/);
});

test("confirmed employment can satisfy employer role and industry checklist",()=>{
  assert.match(portal,/employmentStatus==="confirmed"&&confirmedReady/);
  assert.match(portal,/client-check-employer/);
  assert.match(portal,/client-check-job-title/);
  assert.match(portal,/client-check-industry/);
});

test("work email and employer website domains can be compared without deciding verification",()=>{
  assert.match(portal,/Work-email domain matches employer website domain/);
  assert.match(portal,/Work-email domain does not match the employer website domain/);
});


test("license and credential verification route is permission protected",()=>{
  assert.match(worker,/\/api\/admin\/clients\/credential-verification/);
  assert.match(worker,/\["\/api\/admin\/clients\/credential-verification", "edit_verification"\]/);
});

test("credential verification persists structured public license fields",()=>{
  assert.match(worker,/CREATE TABLE IF NOT EXISTS client_credential_verifications/);
  assert.match(worker,/credential_status TEXT NOT NULL DEFAULT 'not_checked'/);
  assert.match(worker,/disciplinary_indicator TEXT NOT NULL DEFAULT 'unknown'/);
  assert.match(worker,/source_url TEXT NOT NULL DEFAULT ''/);
});

test("confirmed credential requires an official source",()=>{
  assert.match(worker,/Occupation, credential type, license number, issuing state, issuing board, and an official source are required before marking a credential Active \/ verified/);
});

test("portal has License and Credential Verification as section 3",()=>{
  assert.match(portal,/3\. License &amp; Credential Verification/);
  assert.match(portal,/6\. Persona/);
  assert.match(portal,/8\. Audit History/);
});

test("registry routing includes official licensing sources",()=>{
  assert.match(portal,/https:\/\/search\.dca\.ca\.gov\/advanced/);
  assert.match(portal,/https:\/\/apps\.calbar\.ca\.gov\/attorney\/LicenseeSearch\/QuickSearch/);
  assert.match(portal,/https:\/\/www\.nursys\.com\/LQC\/LQCTerms\.aspx/);
  assert.match(portal,/https:\/\/npiregistry\.cms\.hhs\.gov\/search\//);
  assert.match(portal,/https:\/\/brokercheck\.finra\.org\//);
});

test("NPI is treated as supporting provider data instead of licensure proof",()=>{
  assert.match(portal,/NPI only as supporting provider data/);
});


test("booking final approval stays a separate admin decision",()=>{
  const route=worker.slice(worker.indexOf('url.pathname === "/api/admin/request/final-approve"'));
  assert.match(route,/Deposit must be confirmed before final approval/);
  assert.match(route,/Screening must be marked Verified and completed before final approval/);
  assert.match(route,/status = 'approved'/);
  assert.match(route,/final_approval = 1/);
  const continuationStart=worker.indexOf('url.pathname === "/api/booking/continuation"');
  const continuationEnd=worker.indexOf("// Reject unsupported methods to request API",continuationStart);
  const continuation=worker.slice(continuationStart,continuationEnd);
  assert.doesNotMatch(continuation,/SET[\s\S]{0,300}status = 'approved'/);
  assert.doesNotMatch(continuation,/final_approval = 1/);
});

test("booking availability keeps duration-aware lookup and minimum notice",()=>{
  assert.match(worker,/siteAvailableSlots\(env, date, duration\)/);
  assert.match(worker,/requestedStart\.getTime\(\) < Date\.now\(\) \+ 2 \* 60 \* 60 \* 1000/);
  assert.match(worker,/Please choose a start time at least 2 hours from the time you submit your request/);
});

test("outcall still requires complete location details",()=>{
  assert.match(worker,/appointmentType === "outcall" &&\s*\(!outcallAddressLine1 \|\| !outcallCity \|\| !outcallState \|\| !outcallPostalCode\)/);
  assert.match(worker,/Please complete the outcall address/);
});


test("initial booking form defers deposit method until private continuation",()=>{
  assert.doesNotMatch(requestPage,/name="deposit_payment_method"/);
  assert.doesNotMatch(requestPage,/name="deposit_acknowledgement"/);
  assert.match(requestPage,/No payment is due when you submit this request/);
  assert.match(continuationPage,/name="deposit_payment_method"/);
  assert.match(continuationPage,/Gift Card/);
  assert.match(continuationPage,/Stripe \(10% processing fee\)/);
  assert.match(continuationPage,/Crypto \(10% processing fee\)/);
});

test("continuation calculates and persists the selected deposit method",()=>{
  const routeStart=worker.indexOf('url.pathname === "/api/booking/continuation" && request.method === "POST"');
  const routeEnd=worker.indexOf("// Reject unsupported methods to request API",routeStart);
  const route=worker.slice(routeStart,routeEnd);
  assert.match(route,/allowedDepositPaymentMethods=new Set\(\["gift-card","stripe","crypto"\]\)/);
  assert.match(route,/finalDepositAmount/);
  assert.match(route,/Deposit payment method: /);
  assert.match(route,/UPDATE date_requests SET deposit_amount=\?,notes=\?/);
});


test("final public booking section stays lightweight and audited",()=>{
  assert.match(requestPage,/BEFORE YOU SUBMIT/);
  assert.match(requestPage,/One last thing\./);
  assert.doesNotMatch(requestPage,/>\s*SCREENING\s*</);
  assert.match(worker,/SCREENING_ACKNOWLEDGEMENT_VERSION = "screening-private-v3"/);
  assert.match(worker,/I understand that private screening is required before final approval and that I’ll receive next-step instructions only if my request moves forward/);
});
