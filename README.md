# Kendra Bexly Website

Public website and Cloudflare Worker portal for KendraBexly.com.

## Deployment
Cloudflare Workers deploy command: `npx wrangler deploy`

No build command is required. Production deployments are triggered by commits to `main`.

## Private client ID documents
Client ID images are stored in the private R2 bucket bound as `ID_DOCUMENTS`. Upload, preview, verification, replacement, and permanent deletion are available only through the Cloudflare Access-protected portal and `/api/admin/*` routes. ID images are never stored in public assets, emailed, or exposed with a public bucket URL.
<!-- Cloudflare deploy sync: 2026-09-24 combined-page-mobile-gallery-newsletter -->
