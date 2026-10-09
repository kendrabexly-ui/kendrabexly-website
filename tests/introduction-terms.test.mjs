import { normalizeTerms, termsVersion, hasAcceptedTerms } from "./introduction-terms.js";
import test from "node:test";
import assert from "node:assert/strict";
test("terms normalize safely", () => assert.equal(normalizeTerms("  Hello  "), "Hello"));
test("terms version changes with wording", () => assert.notEqual(termsVersion("First"), termsVersion("Second")));
test("acceptance must match current terms", () => {
 const current = "Terms apply";
 assert.equal(hasAcceptedTerms({terms_accepted:"yes",terms_version:termsVersion(current)},current),true);
 assert.equal(hasAcceptedTerms({terms_accepted:"yes",terms_version:"old"},current),false);
 assert.equal(hasAcceptedTerms({terms_accepted:"no",terms_version:termsVersion(current)},current),false);
});
