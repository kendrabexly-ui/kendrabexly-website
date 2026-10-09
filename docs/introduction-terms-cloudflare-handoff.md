# Introduction Terms: Cloudflare production handoff

Repository: kendrabexly-ui/kendrabexly-website
Branch: feature/intro-terms-editor
Pull request: #63
Worker: kendrabexly
D1: kendrabexly-db

## Before merging / deploying
1. Review PR #63 and ensure the feature branch has passed `npm test` and `npx wrangler deploy --dry-run`. If GitHub Actions is unavailable, run these from a checked-out repository with Node 24.
2. Back up D1 using your approved backup procedure.
3. Inspect schema before migration:
   `npx wrangler d1 execute kendrabexly-db --remote --command "PRAGMA table_info(date_requests);"`
4. **Only if the two columns are absent**, apply the SQL in `migrations/introduction_terms_acceptances.sql`:
   `npx wrangler d1 execute kendrabexly-db --remote --file migrations/introduction_terms_acceptances.sql`
   Do not apply the migration twice. If either column already exists, inspect and reconcile the schema manually.
5. Verify both `terms_accepted_at` and `terms_version` exist in `date_requests`.
6. Merge PR #63 only after checks and schema readiness. The existing main-branch deployment pipeline may deploy automatically; verify its behavior before merging. If manual deployment is needed, run `npx wrangler deploy` from the merged repository.

## Initialize terms
The form intentionally refuses new screening-only introductions while terms are empty. Immediately after deployment, sign into the authenticated /portal/ and open **Terms & Conditions — Introduction Form**. Paste the approved text and click Save. Confirm GET /api/public/introduction-terms returns nonempty `terms` and `version`. Do not paste terms into source files or public database console logs.

## Live smoke test (use a controlled test record)
- Open /request. Confirm current terms load and the checkbox is initially unchecked.
- Attempt to submit without acceptance: browser blocks.
- Attempt direct POST /api/request with `screening_only:true` and missing acceptance: HTTP 400; no new request should be created.
- Submit with acceptance: request enters the existing pending screening queue; verify `date_requests.terms_accepted_at` and `terms_version` are populated.
- Update terms through the portal. Attempt submission with the old version: HTTP 400.
- Verify blacklist review, phone verification, identity/background screening, Move Forward, deposit, ID, and final confirmation using test-only data. Do not charge real payments or send client communications during testing.

## Restrictions
- Public WordPress remains on WordPress; private portal and APIs remain on Cloudflare.
- No DNS, route, rate, service, or payment changes.
- Never deploy the Worker before D1 is compatible; do not merge an untested build.
- Cloudflare dashboard assistant cannot edit GitHub or deploy the compiled source itself. A repository-connected CI/CD runner or authorized Wrangler environment must execute the deployment.
