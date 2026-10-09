import test from "node:test";
import assert from "node:assert/strict";
import { handleIntroductionTermsAdmin } from "../src/introduction-terms-admin-api.js";
import { handlePublicIntroductionTerms } from "../src/introduction-terms-public-api.js";

function makeEnv() {
  let value = "Existing terms";
  return { DB: { prepare(sql) {
    return { bind(...args) {
      return {
        async first() { assert.match(sql, /SELECT/); return { setting_value: value }; },
        async run() { assert.match(sql, /INSERT/); value = args[1]; return { success: true }; }
      };
    } };
  } } };
}

test("public endpoint permits only GET and returns current terms", async () => {
  const env = makeEnv();
  const response = await handlePublicIntroductionTerms(new Request("https://example.test/api/public/introduction-terms"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).terms, "Existing terms");
  const rejected = await handlePublicIntroductionTerms(new Request("https://example.test/api/public/introduction-terms", { method: "PUT" }), env);
  assert.equal(rejected.status, 405);
});
test("admin endpoint validates input and saves updated terms", async () => {
  const env = makeEnv();
  const invalid = await handleIntroductionTermsAdmin(new Request("https://example.test/api/admin/introduction-terms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terms: 4 }) }), env);
  assert.equal(invalid.status, 400);
  const saved = await handleIntroductionTermsAdmin(new Request("https://example.test/api/admin/introduction-terms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terms: "New terms" }) }), env);
  assert.equal(saved.status, 200);
  const read = await handleIntroductionTermsAdmin(new Request("https://example.test/api/admin/introduction-terms"), env);
  assert.equal((await read.json()).terms, "New terms");
});
