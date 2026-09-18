export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple API test to confirm the Worker and D1 are connected.
    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM clients")
          .first();

        return Response.json({
          ok: true,
          database: "connected",
          clients: result?.count ?? 0
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            database: "error",
            message: error.message
          },
          { status: 500 }
        );
      }
    }

    // Everything else continues to use the existing website.
    return env.ASSETS.fetch(request);
  }
};
