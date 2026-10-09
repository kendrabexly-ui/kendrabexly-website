# Consolidated verification workflow — implementation specification

Status: consolidated workflow specification. External-check report placeholders exist; provider integrations and end-to-end deployment are not complete.

## Single source of truth
Use the submitted introduction/request record and linked client profile. Display submitted name, DOB, phone, email, government ID reference, profile/business URL, selected experience, requested appointment, and deposit method read-only. Do not duplicate editable fields or persist duplicate copies. Preserve existing records.

## One screening review
Keep only: blacklist reviewed (manual third-party check), phone non-VOIP reviewed, identity/background reviewed, submitted information consistent, one optional private notes field, and Approve / Decline / Needs clarification decision. Never automatically approve. Store audit timestamps and actor; avoid unnecessary sensitive background details.

## Screening evidence categories (in the same review, not additional screens)
- **Twilio Lookup:** display line type (mobile/landline/VoIP/unknown), carrier metadata if licensed, lookup timestamp, and whether phone ownership was separately verified. Twilio line type alone does not establish phone ownership; use Verify OTP for ownership if enabled. If unconfigured, show Not configured, not Clear.
- **ID record:** display securely retained document review status and an independently sourced identity match only when an authorized ID validation provider is configured. Never suggest direct government ID database access without a contracted provider. Keep raw ID files private in R2.
- **Licenses and credentials:** optional when the person claims a regulated profession or credential; capture issuing authority, registry URL, license type, number masked in UI, status, and date checked. Credential assertions are not equivalent to a valid government license.
- **Public records:** capture citation/source URL, jurisdiction, date, match confidence, and manual reviewer notes. Never match by name alone.
- **Criminal records:** review only through lawful permitted sources with legally required notice/consent; consider FCRA and California investigative consumer-report restrictions when screening involves a report provider. Do not automatically approve or reject on an arrest, name similarity, or index hit.
- **Court and docket index search:** record court/jurisdiction, index, case identifier (masked when appropriate), result relevance, and timestamp. Docket/index search is not a comprehensive criminal background check.
- Statuses: Not checked, Not configured, Needs review, Reviewed/no relevant match, Potential match, Unable to verify. Reserve **Verified** for a confirmed source match and explicitly distinguish document review from identity confirmation.
- Only the owner makes the final screening decision. Keep the notes and evidence in the private Cloudflare portal, not email or WordPress. Avoid bulk storage of criminal history or unnecessary personal identifiers.
- Never conduct or claim automatic searches without configured API credentials, provider access, required consent, and working end-to-end tests.

## Two outbound client emails
1. Deposit request: once screening is approved, send one idempotent deposit email with the chosen method and existing deposit terms. Do not automatically treat email delivery as payment.
2. Location address: schedule for exactly 2 hours before appointment in America/Los_Angeles; only when approved, deposit confirmed, appointment active, and location configured. Send once with idempotency key; do not include sensitive screening data. On cancellation suppress; on reschedule invalidate pending schedule and recalculate. If confirmation occurs inside the 2-hour window, hold for manual review rather than emailing unexpectedly.

## Remove obsolete steps
Remove duplicate ID request, redundant verification forms, repeated contact fields, and unnecessary client-facing approval/confirmation emails from this workflow only after checking dependencies and preserving historical records. Keep Terms & Conditions acceptance, administrative controls, and existing booking records intact.

## Implementation / release checks
- Review current Worker endpoints, D1 schema, portal UI and cron/queue scheduling before editing.
- Add migration only when necessary; preserve historical records.
- Test submit → screening → approval → deposit email → deposit confirmation → address email, plus decline, cancellation, reschedule, duplicate retries, and daylight-saving transitions.
- Deploy portal assets and Worker together to Cloudflare after passing tests; do not change WordPress public pages or DNS routing.
