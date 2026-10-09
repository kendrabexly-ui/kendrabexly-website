import { readIntroductionTerms } from "./introduction-terms-store.js";
import { hasAcceptedTerms, termsVersion } from "./introduction-terms.js";

// Invoke before creating a new introduction request. Returns a safe error response
// when the client has not accepted the currently published terms.
export async function validateIntroductionTermsAcceptance(db, submission) {
  const { terms } = await readIntroductionTerms(db);
  if (!terms) return { ok: false, status: 503, message: "Terms & Conditions are not available. Please try again later." };
  if (!hasAcceptedTerms(submission, terms)) {
    return { ok: false, status: 400, message: "Please read and accept the current Terms & Conditions before continuing." };
  }
  return { ok: true, terms_version: termsVersion(terms), terms_accepted_at: new Date().toISOString() };
}
