import { normalizeTerms, termsVersion } from "./introduction-terms.js";

// Data access functions for introduction terms. Call only after admin authentication
// for writes. Uses the existing site_settings table in Cloudflare D1.
export async function readIntroductionTerms(db) {
  const row = await db.prepare("SELECT setting_value FROM site_settings WHERE setting_key = ?").bind("introduction_terms").first();
  const terms = row?.setting_value || "";
  return { terms, version: termsVersion(terms) };
}
export async function saveIntroductionTerms(db, input) {
  const terms = normalizeTerms(input);
  await db.prepare("INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP").bind("introduction_terms", terms).run();
  return { terms, version: termsVersion(terms) };
}
