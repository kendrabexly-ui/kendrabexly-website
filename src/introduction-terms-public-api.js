import { readIntroductionTerms } from "./introduction-terms-store.js";

// Public read-only handler. Wire this to GET /api/public/introduction-terms
// in the Cloudflare Worker; never expose the admin write handler here.
export async function handlePublicIntroductionTerms(request, env) {
  if (request.method !== "GET") {
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  }
  const data = await readIntroductionTerms(env.DB);
  return Response.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
}
