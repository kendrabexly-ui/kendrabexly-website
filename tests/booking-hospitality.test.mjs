import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const from = source.indexOf("function standaloneBookingPage()");
assert.ok(from > 0, "Booking page function exists");
const to = source.indexOf("\nfunction ", from + 20);
const booking = source.slice(from, from + 50000);

test("introduction still posts to the existing secured request endpoint with screening-only flag", () => {
  assert.match(booking, /new FormData\(f\)/);
  assert.match(booking, /payload\.set\("screening_only","true"\)/);
  assert.match(booking, /fetch\("\/api\/request",\{method:"POST",body:payload\}\)/);
  assert.match(source, /validateIntroductionTermsAcceptance\(env\.DB, data\)/);
});
test("all required identity, photo and screening controls remain", () => {
  for (const name of ["first_name","last_name","age","occupation","base_state","phone","email","screening_method","intro_photo"]) {
    assert.ok(booking.includes('name="'+name+'"'), name+" remains");
  }
  assert.match(booking,/id="terms-accepted"[^>]*required disabled/);
  assert.match(booking,/name="intro_preferred_time"/);
  assert.match(source,/two hours away/);
});
test("location value and screening choices are unchanged while labels are clearer", () => {
  assert.match(booking,/data-field="intro-location" data-value="incall"[^>]*>[\s\S]*?Visit Kendra/);
  assert.match(booking,/data-field="intro-location" data-value="outcall"[^>]*>[\s\S]*?Have Kendra Visit You/);
  for (const v of ["government-id","linkedin","employment"]) assert.ok(booking.includes('value="'+v+'"'));
});
test("optional hospitality notes are bounded and retained on private request", () => {
  assert.match(booking,/name="intro_hospitality" maxlength="400"/);
  assert.match(source,/const introHospitality = String\(data\.intro_hospitality \|\| ""\)\.trim\(\)/);
  assert.match(source,/Personal touch: \$\{introHospitality \|\| "Not specified"\}/);
});
test("deposit choices and existing verification flow remain unchanged", () => {
  for (const value of ["cash-app","gift-card","crypto"]) assert.ok(booking.includes('value="'+value+'"'));
  assert.match(booking,/No payment is collected before screening approval/);
  assert.match(booking,/Once everything is confirmed, which deposit method would you prefer/);
});
