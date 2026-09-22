import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const portal=fs.readFileSync(new URL("../public/portal/index.html",import.meta.url),"utf8");
const requestPage=fs.readFileSync(new URL("../public/request.html",import.meta.url),"utf8");
const continuationPage=fs.readFileSync(new URL("../public/complete/index.html",import.meta.url),"utf8");
const requestAdmin=fs.readFileSync(new URL("../public/portal/request/index.html",import.meta.url),"utf8");
const security=fs.readFileSync(new URL("../src/verification-security.js",import.meta.url),"utf8");

test("initial booking request collects occupation for basic screening",()=>{
  assert.match(requestPage,/label for="occupation"[\s\S]*What is your occupation\? \*/);
  assert.match(requestPage,/name="occupation"[\s\S]*required/);
  assert.match(worker,/const occupation =[\s\S]*String\(data\.occupation \|\| ""\)\.trim\(\)\.slice\(0, 160\)/);
  assert.match(worker,/!occupation \|\|/);
  assert.match(worker,/`Occupation: \$\{occupation\}`/);
});

test("initial booking request collects a validated base state for basic screening",()=>{
  assert.match(requestPage,/label for="base-state"[\s\S]*What is your base state\? \*/);
  assert.match(requestPage,/name="base_state"[\s\S]*required/);
  assert.match(worker,/const baseState =[\s\S]*String\(data\.base_state \|\| ""\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(worker,/!baseState \|\|/);
  assert.match(worker,/VALID_BOOKING_STATE_CODES\.has\(baseState\)/);
  assert.match(worker,/`Base state: \$\{baseState\}`/);
});

test("booking submission shows the server response instead of hiding it behind a generic error",()=>{
  assert.match(requestPage,/const responseText = await response\.text\(\)/);
  assert.match(requestPage,/result = responseText \? JSON\.parse\(responseText\) : \{\}/);
  assert.match(requestPage,/status\.textContent =[\s\S]*error\?\.message \|\|/);
  assert.match(requestPage,/no longer available\|choose another opening/);
});

test("dashboard verification starts with request-based basic screening",()=>{
  assert.match(portal,/data-progress-step="basic_screening">Basic Screening/);
  assert.match(portal,/class="verification-card client-basic-screening is-collapsed"/);
  assert.match(portal,/>1\. Basic Screening</);
  assert.match(portal,/latestOccupation = requestNoteValue\("Occupation"\)/);
  assert.match(portal,/latestBaseState = requestNoteValue\("Base state"\)/);
  assert.match(portal,/<strong>Base state<\/strong><div>\$\{escapeHtml\(latestBaseState \|\| "Not provided"\)\}<\/div>/);
  assert.match(portal,/client-basic-screening-open-request/);
  assert.match(portal,/client-basic-screening-open-request"\)\.forEach\(\(button\)=>button\.addEventListener\("click",\(\)=>\{[\s\S]*\/portal\/request\?id=\$\{encodeURIComponent\(requestId\)\}/);
  assert.match(portal,/>2\. ID Record</);
  assert.match(portal,/>3\. Employment Verification</);
  assert.match(portal,/>4\. Final Verification Checklist</);
  assert.match(portal,/>9\. Final Review &amp; Decision</);
  assert.match(portal,/>10\. Audit History</);
  assert.match(portal,/finalReady=basicScreening==="confirmed"/);
});

test("verification field cards start collapsed and navigation expands them",()=>{
  for(const cardClass of [
    "client-basic-screening",
    "client-id-record",
    "client-employment-verification",
    "client-verification-editor",
    "client-credential-card",
    "client-address-verification-card",
    "client-public-record-card",
    "client-persona-card",
    "client-final-review"
  ]){
    assert.ok(portal.includes(`class="verification-card ${cardClass} is-collapsed`),`${cardClass} should start collapsed`);
  }
  assert.match(portal,/const expandVerificationTarget=\(target\)=>/);
  assert.match(portal,/const card=target\.matches\("\.verification-card"\)\?target:target\.closest\("\.verification-card"\)/);
  assert.match(portal,/card\.classList\.remove\("is-collapsed"\)/);
  assert.match(portal,/expandVerificationTarget\(target\);[\s\S]*loadVerificationCardData\(target\)/);
});

test("employment is separate from the final checklist and Final Review confirms the decision",()=>{
  const employmentStart=portal.indexOf('class="verification-card client-employment-verification is-collapsed"');
  const checklistStart=portal.indexOf('class="verification-card client-verification-editor is-collapsed"');
  const credentialStart=portal.indexOf('class="verification-card client-credential-card is-collapsed"');
  assert.ok(employmentStart>0&&checklistStart>employmentStart&&credentialStart>checklistStart);
  const employmentCard=portal.slice(employmentStart,checklistStart);
  const finalChecklist=portal.slice(checklistStart,credentialStart);
  assert.match(employmentCard,/client-verification-employer/);
  assert.match(employmentCard,/client-employment-method/);
  assert.doesNotMatch(finalChecklist,/client-verification-employer/);
  assert.match(finalChecklist,/client-persona-birthdate/);
  assert.match(finalChecklist,/client-check-identity/);
  assert.match(finalChecklist,/client-verification-status/);
  assert.match(finalChecklist,/client-verification-decision-notes/);
  assert.match(portal,/client-final-review-summary[\s\S]*Final decision:/);
  assert.match(portal,/client-final-review-complete[\s\S]*confirmVerificationDecision/);
});

test("client dashboard renders verification profiles in bounded batches",()=>{
  assert.match(portal,/const baseClientRenderLimit = window\.matchMedia\("\(max-width: 700px\)"\)\.matches \? 5 : 10/);
  assert.match(portal,/const visibleClients=filtered\.slice\(0,clientRenderLimit\)/);
  assert.match(portal,/class="client-load-more"/);
  assert.match(portal,/clientRenderLimit\+=baseClientRenderLimit/);
  assert.match(portal,/clientSearch\.oninput=/);
  assert.doesNotMatch(portal,/clientSearch\.addEventListener\("input", renderClients\)/);
});

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
  assert.match(portal,/Decision: /);
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
  assert.match(portal,/class="verification-card client-employment-verification is-collapsed"/);
  assert.match(portal,/>3\. Employment Verification</);
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

test("portal has License and Credential Verification after basic screening",()=>{
  assert.match(portal,/5\. License &amp; Credential Verification/);
  assert.match(portal,/8\. Persona/);
  assert.match(portal,/10\. Audit History/);
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

test("outcall starts lightweight and defers exact address to screening",()=>{
  assert.match(worker,/appointmentType === "outcall" &&\s*\(!outcallAddressLine1 \|\| !outcallCity\)/);
  assert.match(worker,/Please provide the outcall hotel, property, or neighborhood and city/);
  assert.match(requestPage,/Hotel, property, or neighborhood/);
  assert.doesNotMatch(requestPage,/id="outcall-state"/);
  assert.match(continuationPage,/id="screening-outcall-address"/);
  assert.match(worker,/Complete the exact outcall address before submitting screening/);
});


test("initial booking form defers deposit method until private continuation",()=>{
  assert.doesNotMatch(requestPage,/name="deposit_payment_method"/);
  assert.doesNotMatch(requestPage,/name="deposit_acknowledgement"/);
  assert.doesNotMatch(requestPage,/No payment/i);
  assert.match(continuationPage,/name="deposit_payment_method"/);
  assert.match(continuationPage,/data-method="gift-card"/);
  assert.match(continuationPage,/data-method="stripe"/);
  assert.match(continuationPage,/data-method="crypto"/);
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

test("deposit step optionally collects a separate app-based text number",()=>{
  assert.match(continuationPage,/label for="continuation-app-text-number">App-based number for text communication/);
  assert.match(continuationPage,/name="app_text_number" type="tel"/);
  assert.match(continuationPage,/This does not replace the standard mobile number used for basic screening/);
  assert.match(worker,/const appTextNumber=String\(data\.app_text_number\|\|""\)\.trim\(\)\.slice\(0,40\)/);
  assert.match(worker,/Enter a valid app-based text number or leave it blank/);
  assert.match(worker,/App-based text number: " \+ appTextNumber/);
  assert.match(worker,/app_text_number:String\(row\.notes\|\|""\)\.match/);
});


test("booking form has no before-you-submit section or acknowledgement",()=>{
  assert.doesNotMatch(requestPage,/BEFORE YOU SUBMIT/);
  assert.doesNotMatch(requestPage,/One last thing\./);
  assert.doesNotMatch(requestPage,/screening-acknowledgement/);
  assert.doesNotMatch(worker,/Please acknowledge the screening requirement/);
  assert.match(worker,/0,\s*"",\s*"not_present"/);
});


test("continuation keeps deposit hidden until screening is verified",()=>{
  assert.match(continuationPage,/id="screening-form"/);
  assert.match(continuationPage,/No deposit is requested at this stage/);
  assert.match(continuationPage,/if \(!data\.deposit_unlocked\)/);
  assert.match(continuationPage,/id="deposit-form" hidden/);
  const routeStart=worker.indexOf('url.pathname === "/api/booking/continuation" && request.method === "POST"');
  const routeEnd=worker.indexOf("// Reject unsupported methods to request API",routeStart);
  const route=worker.slice(routeStart,routeEnd);
  assert.match(route,/if\(step==="screening"\)/);
  assert.match(route,/if\(step==="deposit"\)/);
  assert.match(route,/Deposit selection is not available until screening is completed and verified/);
});

test("request deposit admin action requires verified screening",()=>{
  assert.match(worker,/\/api\/admin\/request\/request-deposit/);
  assert.match(worker,/The client must submit screening details before a deposit can be requested/);
  assert.match(worker,/Mark screening Verified before requesting a deposit/);
  assert.match(worker,/email_type='deposit_request'/);
  assert.match(worker,/UPDATE date_requests SET status='pending_final_approval'/);
  assert.match(requestAdmin,/id="request-deposit-button"/);
  assert.match(requestAdmin,/screeningReadyForDeposit/);
});

test("move forward email requests screening only",()=>{
  const start=worker.indexOf('url.pathname === "/api/admin/request/move-forward"');
  const end=worker.indexOf("// CALCULATE / REPAIR DEPOSIT",start);
  const route=worker.slice(start,end);
  assert.match(route,/SET status = 'screening_pending'/);
  assert.match(route,/No deposit is requested at this stage/);
  assert.match(route,/separate deposit request/);
});

test("deposit confirmation requires client deposit-step completion",()=>{
  const start=worker.indexOf('url.pathname === "/api/admin/request/confirm-deposit"');
  const end=worker.indexOf('url.pathname === "/api/admin/request/complete"',start);
  const route=worker.slice(start,end);
  assert.match(route,/deposit_step_acknowledged/);
  assert.match(route,/client must complete the deposit selection step before payment can be confirmed/);
});


test("initial booking request stays non-transactional",()=>{
  assert.doesNotMatch(requestPage,/BOOKING SUMMARY/);
  assert.doesNotMatch(requestPage,/early-price-estimate/);
  assert.doesNotMatch(requestPage,/No payment/i);
  assert.doesNotMatch(requestPage,/charged/i);
  assert.doesNotMatch(requestPage,/deposit/i);
  assert.doesNotMatch(requestPage,/Estimated total/i);
  assert.match(requestPage,/private link to complete screening details/);
  assert.match(requestPage,/After screening is complete, I’ll let you know the next step/);
});

test("plans note is collected only during private screening",()=>{
  assert.doesNotMatch(requestPage,/Anything you'd like me to know about your plans\?/);
  assert.doesNotMatch(requestPage,/name="request_details"/);
  assert.match(continuationPage,/Anything you'd like me to know about your plans\?/);
  assert.match(continuationPage,/name="plans_note"/);
  assert.match(worker,/const plansNote=String\(data\.plans_note/);
  assert.match(worker,/Plans note: /);
});

test("fixed-duration experiences auto-select their only duration",()=>{
  assert.match(requestPage,/const available = durationOptions\.filter\(option => !option\.disabled\)/);
  assert.match(requestPage,/if \(available\.length === 1\)/);
  assert.match(requestPage,/durationSelect\.value = available\[0\]\.value/);
});

test("initial request does not show price or deposit summaries",()=>{
  assert.doesNotMatch(requestPage,/id="early-price-estimate"/);
  assert.doesNotMatch(requestPage,/id="booking-summary"/);
  assert.doesNotMatch(requestPage,/function updatePriceEstimate\(\)/);
  assert.doesNotMatch(requestPage,/function updateBookingSummary\(\)/);
});

test("mobile number requirement explains screening purpose",()=>{
  assert.match(requestPage,/Virtual or app-based numbers aren't accepted because your number may be used during private screening/);
});

test("section-level booking funnel events are privacy-safe and dashboard-visible",()=>{
  for(const event of ["about_you_completed","experience_selected","availability_shown","submit_attempted","validation_phone","validation_outcall","validation_availability","validation_other"]){
    assert.match(requestPage,new RegExp(event));
    assert.match(worker,new RegExp(event));
  }
  assert.doesNotMatch(requestPage,/before_submit_reached/);
  assert.doesNotMatch(worker,/before_submit_reached/);
  assert.match(portal,/Initial-form diagnostics/);
  assert.match(portal,/No field values are stored in funnel analytics/);
});

test("deposit choices show exact method totals after verification",()=>{
  assert.match(continuationPage,/function updatePaymentMethodLabels\(\)/);
  assert.match(continuationPage,/Gift Card — /);
  assert.match(continuationPage,/Stripe — /);
  assert.match(continuationPage,/Crypto — /);
  assert.match(continuationPage,/total \("/);
});


test("booking request page is forced through worker with no-cache headers",()=>{
  const wrangler=fs.readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
  assert.match(wrangler,/\/request\*/);
  assert.match(worker,/url\.pathname === "\/request"/);
  assert.match(worker,/url\.pathname === "\/request\/"|url\.pathname === "\/request.html"/);
  assert.match(worker,/Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"/);
});
