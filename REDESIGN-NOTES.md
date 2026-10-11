# Experience Pages Redesign — dev/experience-redesign

## Summary
Four staging-only experience pages share the approved blush-and-cream visual direction and editorial typography. This document describes the source submitted for staging review, not a verified live deployment.

## Files
- `src/experiences-preview.js`: redesigned standalone Worker source for all four pages.
- `wrangler.experiences.jsonc`: unchanged, preserving the separate `kendrabexly-experiences` Worker, workers.dev access, and ASSETS configuration.

## Routes
- `/our-time/` and `/`: Our Time Together overview.
- `/explore-sensual-touch/`: enhanced detail page.
- `/explore-signature-experience/`: enhanced detail page.
- `/explore-grecian-experience/`: enhanced detail page.

## Pricing
| Duration | Sensual Touch | Signature | Grecian |
|---|---:|---:|---:|
| 30 minutes | $255 | $300 | $400 |
| 1 hour | $425 | $500 | $700 |
| 90 minutes | $640 | $750 | $1,000 |
| 2 hours | $850 | $1,000 | $1,300 |
| 4 hours | — | $1,900 | $2,500 |

## Experience page features
Each detail page includes a photographic hero, atmospheric description, interactive duration cards, thoughtful touches, dynamic price summary, and a return link. Durations of 90 minutes or longer display a light snacks and refreshments note.

Styling uses a blush-to-cream gradient, Playfair Display headings, DM Sans body, rounded cards, responsive image layouts, and mauve shadows. Photography uses Unsplash URLs with gradient fallbacks; the CSP permits images from `https://images.unsplash.com`.

## Staging-only safeguards
- `noindex,nofollow` meta tag and X-Robots-Tag header.
- `Cache-Control: no-store`.
- Disabled introduction button. No booking, payment, form submission, or external messaging connections.
- Only GET and HEAD routes supported; other methods return HTTP 405.
- CSP includes `form-action 'none'`.
- Source does not access D1, KV, R2, production secrets, or the production Worker.
- Footer identifies the site as a design preview.

## Deployment boundaries
Changes are confined to `dev/experience-redesign` and intended for the isolated `kendrabexly-experiences` staging Worker. Do not merge into `main` or modify the live `kendrabexly` Worker, WordPress website, DNS, or private portal without explicit approval.

## 403 Forbidden investigation
Previous staging checks reported HTTP 403 for `kendrabexly-experiences.kendrabexly.workers.dev`, with body `Forbidden: requests to kendrabexly-experiences.kendrabexly.workers.dev are not allowed`. `workers_dev` was reported enabled. Cloudflare Access or account-level restrictions were suspected, but the Access applications API check did not confirm a cause. Inspect Zero Trust Access application hostname patterns and policy actions first. Preserve security protections and prefer authenticated email-based access over a public Bypass policy.

## Validation required
Confirm the staging Cloudflare Build version and commit, resolve the 403, and visually/functionally test all four routes on desktop and mobile. Verify photography, pricing, 90-minute refreshments logic, accessibility, and navigation before considering production release.
