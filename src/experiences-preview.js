// Isolated preview entrypoint for Kendra's public experience pages.
// Never import the production Worker, touch production data, or issue outbound
// requests. The booking flow is deliberately disabled in this preview.
const allowedPages = new Set([
  "/our-time",
  "/explore-sensual-touch",
  "/explore-signature-experience",
  "/explore-grecian-experience"
]);
const allowedAssets = new Set([
  "/styles.css",
  "/site-shell.js",
  "/site-content.js",
  "/page-photos.js",
  "/accessibility.css"
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Preview is read-only.", { status: 405 });
    }
    if (path === "/booking" || path === "/request" ||
        path.startsWith("/api/") || path.startsWith("/portal/") ||
        path.startsWith("/admin")) {
      return new Response("Unavailable in isolated design preview.", { status: 404 });
    }
    if (allowedPages.has(path)) {
      // Use the source-controlled static page where present. Pages not yet built
      // must fail closed, rather than fall through to production.
      return env.ASSETS.fetch(new Request(new URL(path + "/", url), request));
    }
    if (allowedAssets.has(path)) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not included in experience preview.", { status: 404 });
  }
};
