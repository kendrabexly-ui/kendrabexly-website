# Experience staging build verification

The isolated experience preview is configured through `wrangler.experiences.jsonc` and `src/experiences-preview.js` on `dev/experience-redesign`.

This documentation-only commit triggers Cloudflare Builds after the staging Worker GitHub connection was enabled. It must not be merged to main or used to deploy the production `kendrabexly` Worker.

Check the staging build target, deployment status, no production bindings, four HTML routes, and pricing before approving any production changes.
