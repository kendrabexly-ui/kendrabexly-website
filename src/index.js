export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // X OAUTH 2.0
    // =========================================================

    if (url.pathname === "/api/auth/x/start" && request.method === "GET") {
      if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
        return Response.json({ ok: false, message: "X OAuth is not configured." }, { status: 500 });
      }

      const stateBytes = crypto.getRandomValues(new Uint8Array(24));
      const state = btoa(String.fromCharCode(...stateBytes))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

      const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
      const verifier = btoa(String.fromCharCode(...verifierBytes))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: env.X_CLIENT_ID,
        redirect_uri: "https://kendrabexly.com/api/auth/x/callback",
        scope: "tweet.read tweet.write users.read offline.access",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      const headers = new Headers({ Location: "https://x.com/i/oauth2/authorize?" + params.toString() });
      headers.append("Set-Cookie", `x_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      headers.append("Set-Cookie", `x_oauth_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === "/api/auth/x/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) return new Response("X authorization was cancelled or denied.", { status: 400 });

      const cookies = Object.fromEntries((request.headers.get("Cookie") || "").split(";").map(v => v.trim().split(/=(.*)/s).slice(0, 2)));
      if (!code || !state || !cookies.x_oauth_state || state !== cookies.x_oauth_state || !cookies.x_oauth_verifier) {
        return new Response("Invalid or expired X authorization request.", { status: 400 });
      }

      const body = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: "https://kendrabexly.com/api/auth/x/callback",
        code_verifier: cookies.x_oauth_verifier
      });

      // X OAuth 2.0 confidential clients authenticate at the token endpoint.
      // Include client_id in the form body as well as HTTP Basic auth for compatibility.
      body.set("client_id", env.X_CLIENT_ID);
      // X requires HTTP Basic authentication for confidential OAuth clients.
      // Build the header explicitly so the credentials survive the Workers subrequest.
      const basic = btoa(String(env.X_CLIENT_ID) + ":" + String(env.X_CLIENT_SECRET));
      const tokenRequest = new Request("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: new Headers([
          ["Authorization", "Basic " + basic],
          ["Content-Type", "application/x-www-form-urlencoded;charset=UTF-8"],
          ["Accept", "application/json"]
        ]),
        body: body.toString()
      });
      const tokenResponse = await fetch(tokenRequest);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        let detail = "unknown_error";
        try {
          const parsed = JSON.parse(errorText);
          detail = parsed.error_description || parsed.error || detail;
        } catch {}
        console.error("X token exchange failed:", tokenResponse.status, detail);
        return new Response("X connection failed (" + tokenResponse.status + ": " + detail + ").", { status: 502 });
      }

      const tokens = await tokenResponse.json();
      if (!tokens.access_token) return new Response("X did not return an access token.", { status: 502 });

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS x_oauth_tokens (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          expires_at INTEGER,
          scope TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      const expiresAt = Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 7200);
      await env.DB.prepare(`
        INSERT INTO x_oauth_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
        VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at,
          scope = excluded.scope,
          updated_at = CURRENT_TIMESTAMP
      `).bind(tokens.access_token, tokens.refresh_token || null, expiresAt, tokens.scope || null).run();

      const headers = new Headers({ Location: "https://kendrabexly.com/?x=connected" });
      headers.append("Set-Cookie", "x_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
      headers.append("Set-Cookie", "x_oauth_verifier=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
      return new Response(null, { status: 302, headers });
    }

    // =========================================================
    // X CONNECTION STATUS + TOKEN REFRESH
    // =========================================================

    if (url.pathname === "/api/admin/x/status" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(`
          SELECT access_token, refresh_token, expires_at, scope, updated_at
          FROM x_oauth_tokens
          WHERE id = 1
        `).first();

        if (!row) {
          return Response.json({ ok: true, connected: false });
        }

        let accessToken = row.access_token;
        let refreshToken = row.refresh_token;
        let expiresAt = Number(row.expires_at || 0);
        const now = Math.floor(Date.now() / 1000);

        // Refresh a little early so a dashboard action never starts with an expired token.
        if (expiresAt <= now + 300) {
          if (!refreshToken) {
            return Response.json({ ok: true, connected: false, reconnect_required: true });
          }

          const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: env.X_CLIENT_ID
          });
          const basic = btoa(String(env.X_CLIENT_ID) + ":" + String(env.X_CLIENT_SECRET));
          const refreshResponse = await fetch(new Request("https://api.x.com/2/oauth2/token", {
            method: "POST",
            headers: new Headers([
              ["Authorization", "Basic " + basic],
              ["Content-Type", "application/x-www-form-urlencoded;charset=UTF-8"],
              ["Accept", "application/json"]
            ]),
            body: body.toString()
          }));

          if (!refreshResponse.ok) {
            console.error("X token refresh failed:", refreshResponse.status);
            return Response.json({ ok: true, connected: false, reconnect_required: true });
          }

          const tokens = await refreshResponse.json();
          accessToken = tokens.access_token;
          refreshToken = tokens.refresh_token || refreshToken;
          expiresAt = now + Number(tokens.expires_in || 7200);

          await env.DB.prepare(`
            UPDATE x_oauth_tokens
            SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
          `).bind(accessToken, refreshToken, expiresAt, tokens.scope || row.scope || null).run();
        }

        const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username,name", {
          headers: { Authorization: "Bearer " + accessToken }
        });

        if (!meResponse.ok) {
          console.error("X user lookup failed:", meResponse.status);
          return Response.json({ ok: true, connected: false, reconnect_required: meResponse.status === 401 });
        }

        const me = await meResponse.json();
        return Response.json({
          ok: true,
          connected: true,
          username: me?.data?.username || null,
          name: me?.data?.name || null,
          expires_at: expiresAt,
          scope: row.scope || null
        });
      } catch (error) {
        console.error("X connection status error:", error);
        return Response.json({ ok: false, message: "Unable to check X connection." }, { status: 500 });
      }
    }

    // =========================================================
    // X AGENT DRAFTS + APPROVAL/PUBLISH
    // =========================================================

    if (url.pathname === "/api/admin/x/drafts" && request.method === "GET") {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS x_post_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          x_post_id TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          published_at TEXT
        )
      `).run();
      const result = await env.DB.prepare(`
        SELECT id, content, status, x_post_id, created_at, updated_at, published_at
        FROM x_post_drafts ORDER BY id DESC LIMIT 50
      `).all();
      return Response.json({ ok: true, drafts: result.results || [] });
    }

    if (url.pathname === "/api/admin/x/drafts" && request.method === "POST") {
      const data = await request.json();
      const topic = String(data.topic || "").trim();
      const details = String(data.details || "").trim();
      let content = String(data.content || "").trim();
      if (!content && topic) {
        content = details ? `${topic}\n\n${details}` : topic;
      }
      if (!content) return Response.json({ ok: false, message: "Add a topic or draft first." }, { status: 400 });
      if (content.length > 280) return Response.json({ ok: false, message: "X posts must be 280 characters or fewer." }, { status: 400 });
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS x_post_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          x_post_id TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          published_at TEXT
        )
      `).run();
      const result = await env.DB.prepare(`
        INSERT INTO x_post_drafts (content, status) VALUES (?, 'draft')
      `).bind(content).run();
      return Response.json({ ok: true, id: result.meta.last_row_id, content, status: "draft" });
    }

    if (url.pathname.startsWith("/api/admin/x/drafts/") && request.method === "PUT") {
      const id = Number(url.pathname.split("/").pop());
      const data = await request.json();
      const content = String(data.content || "").trim();
      if (!Number.isInteger(id) || id < 1) return Response.json({ ok: false, message: "Invalid draft ID." }, { status: 400 });
      if (!content || content.length > 280) return Response.json({ ok: false, message: "Draft must be 1–280 characters." }, { status: 400 });
      const row = await env.DB.prepare("SELECT status FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!row) return Response.json({ ok: false, message: "Draft not found." }, { status: 404 });
      if (row.status === "published") return Response.json({ ok: false, message: "Published posts cannot be edited here." }, { status: 400 });
      await env.DB.prepare("UPDATE x_post_drafts SET content = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(content, id).run();
      return Response.json({ ok: true, status: "draft" });
    }

    if (url.pathname === "/api/admin/x/approve" && request.method === "POST") {
      const data = await request.json();
      const id = Number(data.id);
      if (!Number.isInteger(id) || id < 1) return Response.json({ ok: false, message: "Invalid draft ID." }, { status: 400 });
      const row = await env.DB.prepare("SELECT id, status FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!row) return Response.json({ ok: false, message: "Draft not found." }, { status: 404 });
      if (row.status === "published") return Response.json({ ok: false, message: "This post is already published." }, { status: 400 });
      await env.DB.prepare("UPDATE x_post_drafts SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
      return Response.json({ ok: true, status: "approved" });
    }

    if (url.pathname === "/api/admin/x/publish" && request.method === "POST") {
      const data = await request.json();
      const id = Number(data.id);
      const draft = await env.DB.prepare("SELECT id, content, status FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!draft) return Response.json({ ok: false, message: "Draft not found." }, { status: 404 });
      if (draft.status !== "approved") return Response.json({ ok: false, message: "Approve this draft before publishing." }, { status: 400 });

      let row = await env.DB.prepare("SELECT access_token, refresh_token, expires_at, scope FROM x_oauth_tokens WHERE id = 1").first();
      if (!row) return Response.json({ ok: false, message: "X is not connected." }, { status: 400 });
      let accessToken = row.access_token;
      const now = Math.floor(Date.now() / 1000);
      if (Number(row.expires_at || 0) <= now + 300) {
        if (!row.refresh_token) return Response.json({ ok: false, message: "Reconnect X before publishing." }, { status: 401 });
        const refreshBody = new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token, client_id: env.X_CLIENT_ID });
        const basic = btoa(String(env.X_CLIENT_ID) + ":" + String(env.X_CLIENT_SECRET));
        const rr = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: refreshBody.toString() });
        if (!rr.ok) return Response.json({ ok: false, message: "X connection expired. Please reconnect." }, { status: 401 });
        const tokens = await rr.json();
        accessToken = tokens.access_token;
        const expiresAt = now + Number(tokens.expires_in || 7200);
        await env.DB.prepare("UPDATE x_oauth_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
          .bind(accessToken, tokens.refresh_token || row.refresh_token, expiresAt, tokens.scope || row.scope || null).run();
      }

      const xr = await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.content })
      });
      const xdata = await xr.json().catch(() => ({}));
      if (!xr.ok) {
        console.error("X publish failed:", xr.status, xdata);
        return Response.json({ ok: false, message: xdata?.detail || xdata?.title || "X rejected the post." }, { status: xr.status });
      }
      const postId = xdata?.data?.id || null;
      await env.DB.prepare("UPDATE x_post_drafts SET status = 'published', x_post_id = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(postId, id).run();
      return Response.json({ ok: true, status: "published", x_post_id: postId });
    }
  // ==========================================
  // NEWSLETTER AGENT
  // ==========================================

  async function ensureNewsletterTable() {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS newsletter_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        blog_title TEXT,
        blog_content TEXT,
        special_offer TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sent_at TEXT
      )
    `).run();
  }

  // Get newsletter drafts
  if (
    url.pathname === "/api/admin/newsletter/drafts" &&
    request.method === "GET"
  ) {
    await ensureNewsletterTable();

    const result = await env.DB.prepare(`
      SELECT
        id,
        subject,
        content,
        blog_title,
        blog_content,
        special_offer,
        status,
        created_at,
        updated_at,
        sent_at
      FROM newsletter_drafts
      ORDER BY id DESC
      LIMIT 50
    `).all();

    return Response.json({
      ok: true,
      drafts: result.results || []
    });
  }

  // Create a newsletter draft
  if (
    url.pathname === "/api/admin/newsletter/drafts" &&
    request.method === "POST"
  ) {
    await ensureNewsletterTable();

    const data = await request.json();

    const now = new Date();
    const month = now.toLocaleString("en-US", { month: "long", timeZone: "America/Los_Angeles" });
    const year = now.toLocaleString("en-US", { year: "numeric", timeZone: "America/Los_Angeles" });

    const subject =
      String(data.subject || `${month} with Kendra — A Little Something New`).trim();

    const content =
      String(
        data.content ||
        `Hi there,

Welcome to my ${month} note. I wanted this space to feel personal — a quick way to catch up, share what has been on my mind, and give you something new each month.

This month I am making room for more intentional moments, fresh experiences, and the little details that make time together memorable.

Keep reading for this month's journal feature and a special offer created just for newsletter subscribers.

Until next time,
Kendra`
      ).trim();

    const blogTitle =
      String(data.blog_title || `${month} ${year}: The Beauty of Being Present`).trim();

    const blogContent =
      String(
        data.blog_content ||
        `There is something special about giving a moment your full attention. Life moves quickly, and it is easy to rush from one thing to the next without really enjoying where we are.

This month, I am focusing on being more present — enjoying good conversation, noticing the small details, and making space for experiences that feel genuine instead of hurried.

My journal will continue to be a place where I share a little more of that side of me: what I am enjoying, what I am learning, and what is inspiring me lately.`
      ).trim();

    const specialOffer =
      String(
        data.special_offer ||
        `${month} Newsletter Special: A limited one-time special rate is available to newsletter subscribers this month. Contact me and mention the ${month} newsletter for details. Available for a limited time and subject to availability.`
      ).trim();

    const result = await env.DB.prepare(`
      INSERT INTO newsletter_drafts
      (
        subject,
        content,
        blog_title,
        blog_content,
        special_offer,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'draft')
    `)
      .bind(
        subject,
        content,
        blogTitle,
        blogContent,
        specialOffer
      )
      .run();

    return Response.json({
      ok: true,
      id: result.meta.last_row_id,
      status: "draft"
    });
  }

  // Update or approve a newsletter draft
  if (
    url.pathname.startsWith("/api/admin/newsletter/drafts/") &&
    request.method === "PATCH"
  ) {
    await ensureNewsletterTable();

    const id = Number(url.pathname.split("/").pop());

    if (!Number.isInteger(id) || id < 1) {
      return Response.json(
        { ok: false, message: "Invalid newsletter ID." },
        { status: 400 }
      );
    }

    const data = await request.json();

    const existing = await env.DB.prepare(
      "SELECT * FROM newsletter_drafts WHERE id = ?"
    )
      .bind(id)
      .first();

    if (!existing) {
      return Response.json(
        { ok: false, message: "Newsletter draft not found." },
        { status: 404 }
      );
    }

    if (existing.status === "sent") {
      return Response.json(
        { ok: false, message: "Sent newsletters are read-only." },
        { status: 400 }
      );
    }

    const subject =
      String(data.subject ?? existing.subject).trim();

    const content =
      String(data.content ?? existing.content).trim();

    const blogTitle =
      String(data.blog_title ?? existing.blog_title ?? "").trim();

    const blogContent =
      String(data.blog_content ?? existing.blog_content ?? "").trim();

    const specialOffer =
      String(data.special_offer ?? existing.special_offer ?? "").trim();

    const status =
      data.status === "approved"
        ? "approved"
        : existing.status;

    if (!subject || !content) {
      return Response.json(
        {
          ok: false,
          message: "Subject and newsletter content are required."
        },
        { status: 400 }
      );
    }

    await env.DB.prepare(`
      UPDATE newsletter_drafts
      SET
        subject = ?,
        content = ?,
        blog_title = ?,
        blog_content = ?,
        special_offer = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind(
        subject,
        content,
        blogTitle,
        blogContent,
        specialOffer,
        status,
        id
      )
      .run();

    return Response.json({
      ok: true,
      status
    });
  }
    // =========================================================
    // DATABASE HEALTH CHECK
    // =========================================================

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


    // =========================================================
    // PRIVATE REQUEST FORM
    // =========================================================

    if (
      url.pathname === "/api/request" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const firstName =
          String(data.first_name || "").trim();

        const lastName =
          String(data.last_name || "").trim();

        const email =
          String(data.email || "")
            .trim()
            .toLowerCase();

        const phone =
          String(data.phone || "").trim();

        const requestedDate =
          String(data.requested_date || "").trim();

        const requestedTime =
          String(data.requested_time || "").trim();

        const dateType =
          String(data.date_type || "").trim();

        const appointmentType =
          String(data.appointment_type || "").trim();

        const duration =
          String(data.duration || "").trim();

        const locationName =
          String(data.location_name || "").trim();

        const requestDetails =
          String(data.request_details || "").trim();

        const screeningAcknowledgement =
          data.screening_acknowledgement === "yes";

        const depositAcknowledgement =
          data.deposit_acknowledgement === "yes";


        // Required fields

        if (
          !firstName ||
          !lastName ||
          !email ||
          !phone ||
          !requestedDate ||
          !requestedTime
        ) {
          return Response.json(
            {
              ok: false,
              message:
                "Please complete all required fields."
            },
            { status: 400 }
          );
        }


        // Basic email validation

        const emailPattern =
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
          return Response.json(
            {
              ok: false,
              message:
                "Please enter a valid email address."
            },
            { status: 400 }
          );
        }


        // Screening acknowledgement required

        if (!screeningAcknowledgement) {
          return Response.json(
            {
              ok: false,
              message:
                "Please acknowledge the screening requirement."
            },
            { status: 400 }
          );
        }


        // Deposit acknowledgement required

        if (!depositAcknowledgement) {
          return Response.json(
            {
              ok: false,
              message:
                "Please acknowledge the deposit requirement."
            },
            { status: 400 }
          );
        }


        // Check blacklist by email or phone

        const blacklisted =
          await env.DB
            .prepare(
              `
              SELECT id
              FROM blacklist
              WHERE
                LOWER(email) = LOWER(?)
                OR phone = ?
              LIMIT 1
              `
            )
            .bind(email, phone)
            .first();

        if (blacklisted) {
          return Response.json(
            {
              ok: false,
              message:
                "This request cannot be accepted."
            },
            { status: 403 }
          );
        }


        // Look for an existing client

        let client =
          await env.DB
            .prepare(
              `
              SELECT id
              FROM clients
              WHERE LOWER(email) = LOWER(?)
              ORDER BY id DESC
              LIMIT 1
              `
            )
            .bind(email)
            .first();


        let clientId;


        // Create new client if needed

        if (!client) {
          const clientResult =
            await env.DB
              .prepare(
                `
                INSERT INTO clients
                (
                  first_name,
                  last_name,
                  email,
                  phone,
                  status
                )
                VALUES (?, ?, ?, ?, 'active')
                `
              )
              .bind(
                firstName,
                lastName,
                email,
                phone
              )
              .run();

          clientId =
            clientResult.meta.last_row_id;
        } else {
          clientId = client.id;

          // Keep basic contact information current

          await env.DB
            .prepare(
              `
              UPDATE clients
              SET
                first_name = ?,
                last_name = ?,
                phone = ?
              WHERE id = ?
              `
            )
            .bind(
              firstName,
              lastName,
              phone,
              clientId
            )
            .run();
        }


        // Store the extra request information safely
        // in notes using the existing database schema.

        const notes = [
          dateType
            ? `Date type: ${dateType}`
            : null,

          appointmentType
            ? `Appointment type: ${appointmentType}`
            : null,

          duration
            ? `Duration: ${duration}`
            : null,

          requestDetails
            ? `Request details: ${requestDetails}`
            : null,

          screeningAcknowledgement
            ? "Screening requirement acknowledged: Yes"
            : null,

          depositAcknowledgement
            ? "25% deposit requirement acknowledged: Yes"
            : null
        ]
          .filter(Boolean)
          .join("\n");


        // Create the date request

        const requestResult =
          await env.DB
            .prepare(
              `
              INSERT INTO date_requests
              (
                client_id,
                requested_date,
                requested_time,
                location_name,
                status,
                deposit_amount,
                deposit_paid,
                id_received,
                final_approval,
                notes
              )
              VALUES
              (
                ?,
                ?,
                ?,
                ?,
                'pending',
                0,
                0,
                0,
                0,
                ?
              )
              `
            )
            .bind(
              clientId,
              requestedDate,
              requestedTime,
              locationName,
              notes
            )
            .run();


        const requestId =
          requestResult.meta.last_row_id;


        // Create the first email draft for review.
        // This is NOT automatically sent.

        await env.DB
          .prepare(
            `
            INSERT INTO email_drafts
            (
              client_id,
              date_request_id,
              email_type,
              subject,
              body,
              status
            )
            VALUES (?, ?, ?, ?, ?, 'draft')
            `
          )
          .bind(
            clientId,
            requestId,
            "request_received",
            "Your private request",
            `Hi ${firstName},

Thank you for reaching out. I received your private request and will review the details personally.

Requested date: ${requestedDate}
Requested time: ${requestedTime}

If your request moves forward, I will contact you with the next steps.

Kendra`
          )
          .run();


        return Response.json({
          ok: true,
          message:
            "Thank you. Your private request has been received for review."
        });

      } catch (error) {
        console.error(
          "Request submission error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Your request could not be submitted. Please try again."
          },
          { status: 500 }
        );
      }
    }


    // Reject unsupported methods to request API

    if (url.pathname === "/api/request") {
      return Response.json(
        {
          ok: false,
          message: "Method not allowed."
        },
        {
          status: 405,
          headers: {
            Allow: "POST"
          }
        }
      );
    }


    // =========================================================
    // PRIVATE ADMIN DASHBOARD API
    // =========================================================

    if (
      url.pathname === "/api/admin/dashboard" &&
      request.method === "GET"
    ) {
      try {
        const [
          pendingRequests,
          clients,
          approvedDates,
          recordedPayments
        ] = await Promise.all([
          env.DB
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM date_requests
              WHERE status = 'pending'
              `
            )
            .first(),

          env.DB
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM clients
              `
            )
            .first(),

          env.DB
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM date_requests
              WHERE
                status = 'approved'
                OR final_approval = 1
              `
            )
            .first(),

          env.DB
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM payments
              WHERE payment_status = 'paid'
              `
            )
            .first()
        ]);


        return Response.json({
          ok: true,

          counts: {
            pending_requests:
              pendingRequests?.count ?? 0,

            clients:
              clients?.count ?? 0,

            approved_dates:
              approvedDates?.count ?? 0,

            recorded_payments:
              recordedPayments?.count ?? 0
          }
        });

      } catch (error) {
        console.error(
          "Admin dashboard error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load dashboard information."
          },
          { status: 500 }
        );
      }
    }


    // =========================================================
    // ADMIN REQUEST LIST
    // =========================================================

    if (
      url.pathname === "/api/admin/requests" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                dr.id,
                dr.client_id,
                c.first_name,
                c.last_name,
                c.email,
                c.phone,
                dr.requested_date,
                dr.requested_time,
                dr.location_name,
                dr.status,
                dr.deposit_amount,
                dr.deposit_paid,
                dr.id_received,
                dr.final_approval,
                dr.notes,
                dr.created_at
              FROM date_requests dr
              JOIN clients c
                ON c.id = dr.client_id
              ORDER BY dr.created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          requests: result.results || []
        });

      } catch (error) {
        console.error(
          "Admin requests error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load requests."
          },
          { status: 500 }
        );
      }
    }
// ======================================================
// ADMIN REQUEST DETAIL
// ======================================================

if (
  url.pathname === "/api/admin/request" &&
  request.method === "GET"
) {
  try {
    const id = Number(url.searchParams.get("id"));

    if (!Number.isInteger(id) || id < 1) {
      return Response.json(
        {
          ok: false,
          message: "Invalid request ID."
        },
        { status: 400 }
      );
    }

    const item = await env.DB
      .prepare(`
        SELECT
          dr.id,
          dr.client_id,
          c.first_name,
          c.last_name,
          c.email,
          c.phone,
          dr.requested_date,
          dr.requested_time,
          dr.location_name,
          dr.location_address,
          dr.status,
          dr.deposit_amount,
          dr.deposit_paid,
          dr.id_received,
          dr.final_approval,
          dr.notes,
          dr.created_at
        FROM date_requests dr
        JOIN clients c
          ON c.id = dr.client_id
        WHERE dr.id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();

    if (!item) {
      return Response.json(
        {
          ok: false,
          message: "Request not found."
        },
        { status: 404 }
      );
    }

    return Response.json({
      ok: true,
      request: item
    });

  } catch (error) {
    console.error(
      "Admin request detail error:",
      error
    );

    return Response.json(
      {
        ok: false,
        message: "Unable to load request."
      },
      { status: 500 }
    );
  }
}

    // =========================================================
    // ADMIN CLIENT LIST
    // =========================================================

    if (
      url.pathname === "/api/admin/clients" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                id,
                first_name,
                last_name,
                email,
                phone,
                status,
                total_spent,
                notes,
                created_at
              FROM clients
              ORDER BY created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          clients: result.results || []
        });

      } catch (error) {
        console.error(
          "Admin clients error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load clients."
          },
          { status: 500 }
        );
      }
    }


    // =========================================================
    // ADMIN PAYMENT LIST
    // =========================================================

    if (
      url.pathname === "/api/admin/payments" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                p.id,
                p.client_id,
                p.date_request_id,
                p.amount,
                p.payment_type,
                p.payment_status,
                p.created_at,
                c.first_name,
                c.last_name,
                c.email
              FROM payments p
              JOIN clients c
                ON c.id = p.client_id
              ORDER BY p.created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          payments: result.results || []
        });

      } catch (error) {
        console.error(
          "Admin payments error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load payments."
          },
          { status: 500 }
        );
      }
    }


    // =========================================================
    // ADMIN BLACKLIST
    // =========================================================

    if (
      url.pathname === "/api/admin/blacklist" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                id,
                client_id,
                name,
                email,
                phone,
                reason,
                created_at
              FROM blacklist
              ORDER BY created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          blacklist: result.results || []
        });

      } catch (error) {
        console.error(
          "Admin blacklist error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load blacklist."
          },
          { status: 500 }
        );
      }
    }


    // =========================================================
    // ADMIN EMAIL DRAFTS
    // =========================================================

    if (
      url.pathname === "/api/admin/email-drafts" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                ed.id,
                ed.client_id,
                ed.date_request_id,
                ed.email_type,
                ed.subject,
                ed.body,
                ed.status,
                ed.created_at,
                ed.sent_at,
                c.first_name,
                c.last_name,
                c.email
              FROM email_drafts ed
              LEFT JOIN clients c
                ON c.id = ed.client_id
              ORDER BY ed.created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          email_drafts:
            result.results || []
        });

      } catch (error) {
        console.error(
          "Admin email drafts error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load email drafts."
          },
          { status: 500 }
        );
      }
    }
// ========================================
// UPDATE ADMIN EMAIL DRAFT
// ========================================

if (
  url.pathname.startsWith("/api/admin/email-drafts/") &&
  request.method === "PUT"
) {
  try {
    const id = Number(
      url.pathname.split("/").pop()
    );

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        {
          ok: false,
          message: "Invalid email draft ID."
        },
        { status: 400 }
      );
    }

    const data = await request.json();

    const subject =
      String(data.subject || "").trim();

    const body =
      String(data.body || "").trim();

    if (!subject || !body) {
      return Response.json(
        {
          ok: false,
          message: "Subject and email body are required."
        },
        { status: 400 }
      );
    }

    const existing = await env.DB
      .prepare(
        `SELECT id
         FROM email_drafts
         WHERE id = ?`
      )
      .bind(id)
      .first();

    if (!existing) {
      return Response.json(
        {
          ok: false,
          message: "Email draft not found."
        },
        { status: 404 }
      );
    }

    await env.DB
      .prepare(
        `UPDATE email_drafts
         SET subject = ?,
             body = ?
         WHERE id = ?`
      )
      .bind(
        subject,
        body,
        id
      )
      .run();

    return Response.json({
      ok: true,
      message: "Email draft saved."
    });

  } catch (error) {
    console.error(
      "Email draft update error:",
      error
    );

    return Response.json(
      {
        ok: false,
        message: "Unable to save email draft."
      },
      { status: 500 }
    );
  }
}

    // =========================================================
    // ADMIN NEWSLETTERS
    // =========================================================

    if (
      url.pathname === "/api/admin/newsletters" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await env.DB
            .prepare(
              `
              SELECT
                id,
                month,
                subject,
                blog_title,
                blog_content,
                special_offer,
                status,
                created_at,
                approved_at
              FROM newsletters
              ORDER BY created_at DESC
              LIMIT 100
              `
            )
            .all();


        return Response.json({
          ok: true,
          newsletters:
            result.results || []
        });

      } catch (error) {
        console.error(
          "Admin newsletters error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message:
              "Unable to load newsletters."
          },
          { status: 500 }
        );
      }
    }


    // =========================================================
    // REJECT UNSUPPORTED ADMIN API METHODS
    // =========================================================

   
    // ============================================================
    // MOVE REQUEST FORWARD
    // ============================================================

    if (
      url.pathname === "/api/admin/request/move-forward" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();
        const requestId = Number(data.id);

        if (!Number.isInteger(requestId) || requestId < 1) {
          return Response.json(
            {
              ok: false,
              message: "Invalid request ID."
            },
            { status: 400 }
          );
        }

        const existingRequest = await env.DB
          .prepare(`
            SELECT
              dr.id,
              dr.client_id,
              dr.requested_date,
              dr.requested_time,
              dr.location_name,
              c.first_name,
              c.last_name,
              c.email
            FROM date_requests dr
            JOIN clients c
              ON c.id = dr.client_id
            WHERE dr.id = ?
          `)
          .bind(requestId)
          .first();

        if (!existingRequest) {
          return Response.json(
            {
              ok: false,
              message: "Request not found."
            },
            { status: 404 }
          );
        }

        await env.DB
          .prepare(`
            UPDATE date_requests
            SET status = 'pending_final_approval'
            WHERE id = ?
          `)
          .bind(requestId)
          .run();

        return Response.json({
          ok: true,
          message: "Request moved forward.",
          status: "pending_final_approval"
        });

      } catch (error) {
        console.error(
          "Move request forward error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message: "Unable to move request forward."
          },
          { status: 500 }
        );
      }
    }

        // ============================================================
    // FINAL APPROVE REQUEST
    // ============================================================

    if (
      url.pathname === "/api/admin/request/final-approve" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();
        const requestId = Number(data.id);

        if (!Number.isInteger(requestId) || requestId < 1) {
          return Response.json(
            {
              ok: false,
              message: "Invalid request ID."
            },
            { status: 400 }
          );
        }

        if (data.id_received !== true || data.deposit_paid !== true) {
          return Response.json(
            {
              ok: false,
              message: "ID screening and deposit must both be confirmed."
            },
            { status: 400 }
          );
        }

        const existingRequest = await env.DB
          .prepare(`
            SELECT id, status
            FROM date_requests
            WHERE id = ?
          `)
          .bind(requestId)
          .first();

        if (!existingRequest) {
          return Response.json(
            {
              ok: false,
              message: "Request not found."
            },
            { status: 404 }
          );
        }

        if (existingRequest.status !== "pending_final_approval") {
          return Response.json(
            {
              ok: false,
              message: "Request is not pending final approval."
            },
            { status: 400 }
          );
        }

        await env.DB
          .prepare(`
            UPDATE date_requests
            SET
              status = 'approved',
              id_received = 1,
              deposit_paid = 1,
              final_approval = 1
            WHERE id = ?
          `)
          .bind(requestId)
          .run();
const approvedRequest = await env.DB
  .prepare(`
    SELECT
      dr.id,
      dr.client_id,
      dr.requested_date,
      dr.requested_time,
      dr.location_name,
      c.first_name,
      c.last_name,
      c.email
    FROM date_requests dr
    JOIN clients c
      ON c.id = dr.client_id
    WHERE dr.id = ?
  `)
  .bind(requestId)
  .first();

await env.DB
  .prepare(`
    INSERT INTO email_drafts (
      client_id,
      date_request_id,
      email_type,
      subject,
      body,
      status
    )
    VALUES (?, ?, ?, ?, ?, 'draft')
  `)
  .bind(
    approvedRequest.client_id,
    requestId,
    "date_confirmed",
    "Our date is confirmed",
    `Hi ${approvedRequest.first_name},

Our date is officially confirmed.

Date: ${approvedRequest.requested_date}
Time: ${approvedRequest.requested_time}
Location: ${approvedRequest.location_name}

I'm looking forward to seeing you. I'll send you the exact address for our date location two hours before our scheduled time.

See you soon,
Kendra`
  )
  .run();
        return Response.json({
          ok: true,
          message: "Final approval complete.",
          status: "approved"
        });

      } catch (error) {
        console.error(
          "Final approval error:",
          error
        );

        return Response.json(
          {
            ok: false,
            message: "Unable to complete final approval."
          },
          { status: 500 }
        );
      }
    }

    // ==================================================
// UPDATE EMAIL DRAFT
// ==================================================

if (
  url.pathname === "/api/admin/email-draft/update" &&
  request.method === "POST"
) {
  try {
    const data = await request.json();

    const draftId = Number(data.id);
    const subject = String(data.subject || "").trim();
    const body = String(data.body || "").trim();

    if (!Number.isInteger(draftId) || draftId < 1) {
      return Response.json(
        {
          ok: false,
          message: "Invalid email draft ID."
        },
        { status: 400 }
      );
    }

    if (!subject || !body) {
      return Response.json(
        {
          ok: false,
          message: "Subject and email body are required."
        },
        { status: 400 }
      );
    }

    const existingDraft = await env.DB
      .prepare(`
        SELECT id
        FROM email_drafts
        WHERE id = ?
      `)
      .bind(draftId)
      .first();

    if (!existingDraft) {
      return Response.json(
        {
          ok: false,
          message: "Email draft not found."
        },
        { status: 404 }
      );
    }

    await env.DB
      .prepare(`
        UPDATE email_drafts
        SET
          subject = ?,
          body = ?
        WHERE id = ?
      `)
      .bind(
        subject,
        body,
        draftId
      )
      .run();

    return Response.json({
      ok: true,
      message: "Email draft saved."
    });

  } catch (error) {
    console.error(
      "Email draft update error:",
      error
    );

    return Response.json(
      {
        ok: false,
        message: "Unable to save email draft."
      },
      { status: 500 }
    );
  }
}

    // =========================================================
    // SERVE THE EXISTING WEBSITE
    // =========================================================

    return env.ASSETS.fetch(request);
  }
};
