import { readIntroductionTerms, saveIntroductionTerms } from "./introduction-terms-store.js";

// Route handler for an already authenticated admin API path.
// IMPORTANT: The parent Worker MUST enforce its existing Cloudflare Access/admin
// authorization before invoking this function. Do not expose this handler publicly.
export async function handleIntroductionTermsAdmin(request, env) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method === "GET") {
    const data = await readIntroductionTerms(env.DB);
    return Response.json({ ok: true, ...data }, { headers });
  }
  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, message: "Invalid JSON" }, { status: 400, headers }); }
    if (typeof body?.terms !== "string" || body.terms.length > 12000) {
      return Response.json({ ok: false, message: "Terms must be text up to 12,000 characters." }, { status: 400, headers });
    }
    const data = await saveIntroductionTerms(env.DB, body.terms);
    return Response.json({ ok: true, ...data }, { headers });
  }
  return Response.json({ ok: false, message: "Method not allowed" }, { status: 405, headers: { ...headers, Allow: "GET, PUT" } });
}
