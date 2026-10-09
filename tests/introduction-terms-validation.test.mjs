import test from "node:test";
import assert from "node:assert/strict";
import { validateIntroductionTermsAcceptance } from "../src/introduction-terms-validation.js";
import { termsVersion } from "../src/introduction-terms.js";

const db = {
  prepare(sql) {
    assert.match(sql, /SELECT setting_value FROM site_settings/);
    return { bind(key) {
      assert.equal(key, "introduction_terms");
      return { async first() { return { setting_value: "Please respect our time." }; } };
    } };
  }
};

test("rejects unchecked terms", async () => {
  const result = await validateIntroductionTermsAcceptance(db, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});
test("rejects acceptance of an older version", async () => {
  const result = await validateIntroductionTermsAcceptance(db, { terms_accepted: "yes", terms_version: "outdated" });
  assert.equal(result.ok, false);
});
test("accepts current terms and produces an ISO timestamp", async () => {
  const result = await validateIntroductionTermsAcceptance(db, { terms_accepted: "yes", terms_version: termsVersion("Please respect our time.") });
  assert.equal(result.ok, true);
  assert.equal(result.terms_version, termsVersion("Please respect our time."));
  assert.ok(!Number.isNaN(Date.parse(result.terms_accepted_at)));
});
