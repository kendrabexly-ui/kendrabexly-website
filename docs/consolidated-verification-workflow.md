# Consolidated verification workflow — implementation specification

Status: specification only; not implemented or deployed.

## Single source of truth
Use the submitted introduction/request record and linked client profile. Display submitted name, DOB, phone, email, government ID reference, profile/business URL, selected experience, requested appointment, and deposit method read-only. Do not duplicate editable fields or persist duplicate copies. Preserve existing records.

## One screening review
Keep only: blacklist reviewed (manual third-party check), phone non-VOIP reviewed, identity/background reviewed, submitted information consistent, one optional private notes field, and Approve / Decline / Needs clarification decision. Never automatically approve. Store audit timestamps and actor; avoid unnecessary sensitive background details.

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
