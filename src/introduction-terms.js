// Shared helpers for the introduction-form terms editor.
// Terms are plain text, not HTML, and are stored in the existing site_settings table.
export const TERMS_SETTING_KEY = "introduction_terms";
export function normalizeTerms(value) {
  if (typeof value !== "string") throw new TypeError("Terms must be text");
  return value.trim().slice(0, 12000);
}
export function termsVersion(value) {
  const text = normalizeTerms(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function hasAcceptedTerms(body, currentTerms) {
  return !normalizeTerms(currentTerms) || (body?.terms_accepted === "yes" && body?.terms_version === termsVersion(currentTerms));
}
