# Smart Booking Priority — isolated preview
Status: feature-branch proposal only. Not mounted in the production worker, public booking form, or private portal.

Rules:
1. Rank pending inquiries by requested duration descending.
2. Break equal-duration ties in favor of returning clients whose prior verification is valid and current (supplied by the existing protected verification workflow); then oldest inquiry first.
3. Never alter or displace confirmed appointments.
4. No hold happens by merely ranking a request. An authorized provisional unverified hold expires after 60 minutes, cannot conflict with a confirmed appointment, and cannot turn into confirmation.
5. Screening requirements, human review, and existing booking/email/ID/deposit/security gates remain unchanged.
6. Queue labels are internal only. No client-facing promises of availability.
7. Production integration must use existing authenticated private admin routes, authorization checks, server-side conflict checks, idempotent transactions, audit events and reliable expiry enforcement. Do not create or store fake client records.

Integration checklist: inspect schema; establish reliable duration units; identify canonical confirmed statuses; validate returning-verified evidence freshness; transactional overlap checks; authenticated read-only preview endpoint; run full CI and mobile tests; show preview and version; request approval before changing production.
