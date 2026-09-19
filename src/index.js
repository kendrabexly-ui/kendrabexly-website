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
    // X TIMELINE
    // =========================================================

    if (url.pathname === "/api/admin/x/home-timeline" && request.method === "GET") {
      const token = await env.DB.prepare("SELECT access_token FROM x_oauth_tokens WHERE id = 1").first();
      if (!token) return Response.json({ ok:false, message:"X is not connected." }, { status:400 });
      const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username,name", { headers:{ Authorization:"Bearer " + token.access_token } });
      if (!meResponse.ok) return Response.json({ ok:false, message:"Reconnect X before loading your feed." }, { status:401 });
      const me = await meResponse.json();
      const feedResponse = await fetch("https://api.x.com/2/users/" + encodeURIComponent(me.data.id) + "/timelines/reverse_chronological?max_results=30&tweet.fields=author_id,created_at,conversation_id,public_metrics&expansions=author_id&user.fields=username,name", { headers:{ Authorization:"Bearer " + token.access_token } });
      const feed = await feedResponse.json().catch(()=>({}));
      if (!feedResponse.ok) return Response.json({ ok:false, message:feed?.detail || feed?.title || "Your current X API access could not load the home timeline." }, { status:feedResponse.status });
      const users=Object.fromEntries((feed.includes?.users||[]).map(u=>[u.id,u]));
      const tweets=(feed.data||[]).filter(t=>t.author_id!==me.data.id).map(t=>({id:t.id,text:t.text,created_at:t.created_at,author_name:users[t.author_id]?.name||"",author_username:users[t.author_id]?.username||"",public_metrics:t.public_metrics||{}}));
      return Response.json({ok:true,tweets});
    }

    if (url.pathname === "/api/admin/x/timeline" && request.method === "GET") {
      const token = await env.DB.prepare("SELECT access_token FROM x_oauth_tokens WHERE id = 1").first();
      if (!token) return Response.json({ ok:false, message:"X is not connected." }, { status:400 });

      const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username,name", {
        headers: { Authorization:"Bearer " + token.access_token }
      });
      if (!meResponse.ok) return Response.json({ ok:false, message:"Reconnect X before loading your timeline." }, { status:401 });
      const me = await meResponse.json();

      const timelineResponse = await fetch("https://api.x.com/2/users/" + encodeURIComponent(me.data.id) + "/tweets?max_results=20&exclude=retweets&tweet.fields=created_at,conversation_id,public_metrics", {
        headers: { Authorization:"Bearer " + token.access_token }
      });
      const timeline = await timelineResponse.json().catch(()=>({}));
      if (!timelineResponse.ok) {
        return Response.json({ ok:false, message:timeline?.detail || timeline?.title || "Your current X API access could not load the timeline." }, { status:timelineResponse.status });
      }
      return Response.json({ ok:true, username:me.data.username, tweets:timeline.data || [] });
    }

    if (url.pathname === "/api/admin/x/tweet-replies" && request.method === "GET") {
      const tweetId = String(url.searchParams.get("tweet_id") || "").trim();
      if (!tweetId) return Response.json({ ok:false, message:"Choose a tweet first." }, { status:400 });
      const token = await env.DB.prepare("SELECT access_token FROM x_oauth_tokens WHERE id = 1").first();
      if (!token) return Response.json({ ok:false, message:"X is not connected." }, { status:400 });
      const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username", { headers:{ Authorization:"Bearer " + token.access_token } });
      if (!meResponse.ok) return Response.json({ ok:false, message:"Reconnect X before loading replies." }, { status:401 });
      const me = await meResponse.json();
      const query = "conversation_id:" + tweetId + " -from:" + me.data.username;
      const rr = await fetch("https://api.x.com/2/tweets/search/recent?query=" + encodeURIComponent(query) + "&max_results=20&tweet.fields=author_id,conversation_id,created_at&expansions=author_id&user.fields=username,name", { headers:{ Authorization:"Bearer " + token.access_token } });
      const data = await rr.json().catch(()=>({}));
      if (!rr.ok) return Response.json({ ok:false, message:data?.detail || data?.title || "Your current X API access could not load replies for this tweet." }, { status:rr.status });
      const users = Object.fromEntries((data.includes?.users || []).map(u=>[u.id,u]));
      const replies=(data.data||[]).map(item=>({tweet_id:item.id,text:item.text,created_at:item.created_at,author_name:users[item.author_id]?.name||"",author_username:users[item.author_id]?.username||""}));
      return Response.json({ok:true,replies});
    }

    // =========================================================
    // X REPLIES
    // =========================================================

    if (url.pathname === "/api/admin/x/replies" && request.method === "GET") {
      const token = await env.DB.prepare("SELECT access_token FROM x_oauth_tokens WHERE id = 1").first();
      if (!token) return Response.json({ ok:false, message:"X is not connected." }, { status:400 });
      const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username", { headers:{ Authorization:"Bearer " + token.access_token } });
      if (!meResponse.ok) return Response.json({ ok:false, message:"Reconnect X before loading replies." }, { status:401 });
      const me = await meResponse.json();
      const posts = await env.DB.prepare("SELECT id,x_post_id,content FROM x_post_drafts WHERE status='published' AND x_post_id IS NOT NULL ORDER BY published_at DESC LIMIT 10").all();
      const replies = [];
      for (const post of (posts.results || [])) {
        const query = "conversation_id:" + post.x_post_id + " -from:" + me.data.username;
        const endpoint = "https://api.x.com/2/tweets/search/recent?query=" + encodeURIComponent(query) + "&max_results=10&tweet.fields=author_id,conversation_id,created_at&expansions=author_id&user.fields=username,name";
        const rr = await fetch(endpoint, { headers:{ Authorization:"Bearer " + token.access_token } });
        if (!rr.ok) {
          const detail = await rr.json().catch(()=>({}));
          console.error("X replies lookup failed:", rr.status, detail);
          if (rr.status === 403 || rr.status === 402) return Response.json({ ok:false, message:"Your current X API access does not include conversation search. X may require additional API access for loading replies." }, { status:rr.status });
          continue;
        }
        const data = await rr.json();
        const users = Object.fromEntries((data.includes?.users || []).map(u => [u.id,u]));
        for (const item of (data.data || [])) {
          const author = users[item.author_id] || {};
          replies.push({ tweet_id:item.id, text:item.text, created_at:item.created_at, author_name:author.name || "", author_username:author.username || "", parent_post_id:post.id, parent_x_post_id:post.x_post_id, parent_content:post.content });
        }
      }
      return Response.json({ ok:true, replies });
    }

    if (url.pathname === "/api/admin/x/reply/generate" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok:false, message:"Workers AI is not connected." }, { status:500 });
      const data = await request.json();
      const tweetId = String(data.tweet_id || "").trim(), incoming = String(data.text || "").trim(), parent = String(data.parent_content || "").trim();
      if (!tweetId || !incoming) return Response.json({ ok:false, message:"Reply information is missing." }, { status:400 });
      const ai = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", { messages:[
        { role:"system", content:"Draft one natural reply for Kendra Bexly to an X user who responded to her post. Sound warm, personable, confident, conversational, and human. Keep the conversation flowing. Do not invent personal facts. No labels or quotation marks. Return only the reply." },
        { role:"user", content:"Kendra's post: " + parent + "\nTheir reply: " + incoming }
      ], max_tokens:350, temperature:0.85 });
      const content = String(ai?.response || ai?.result?.response || "").trim().replace(/^[“"]|[”"]$/g,"").trim();
      if (!content) return Response.json({ ok:false, message:"AI returned an empty reply." }, { status:502 });
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS x_reply_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT,in_reply_to_tweet_id TEXT NOT NULL,incoming_text TEXT,content TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',x_reply_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT)").run();
      const result = await env.DB.prepare("INSERT INTO x_reply_drafts (in_reply_to_tweet_id,incoming_text,content,status) VALUES (?,?,?,'draft')").bind(tweetId,incoming,content).run();
      return Response.json({ ok:true, id:result.meta.last_row_id, content, status:"draft" });
    }

    if (url.pathname === "/api/admin/x/reply/approve" && request.method === "POST") {
      const data=await request.json(), id=Number(data.id), content=String(data.content||"").trim();
      if (!Number.isInteger(id)||id<1||!content) return Response.json({ok:false,message:"Reply draft is invalid."},{status:400});
      await env.DB.prepare("UPDATE x_reply_drafts SET content=?,status='approved' WHERE id=? AND status!='sent'").bind(content,id).run();
      return Response.json({ok:true,status:"approved"});
    }

    if (url.pathname === "/api/admin/x/reply/send" && request.method === "POST") {
      const data=await request.json(), id=Number(data.id);
      const draft=await env.DB.prepare("SELECT * FROM x_reply_drafts WHERE id=?").bind(id).first();
      if (!draft) return Response.json({ok:false,message:"Reply draft not found."},{status:404});
      if (draft.status!=="approved") return Response.json({ok:false,message:"Approve this reply before sending."},{status:400});
      const token=await env.DB.prepare("SELECT access_token FROM x_oauth_tokens WHERE id=1").first();
      if (!token) return Response.json({ok:false,message:"X is not connected."},{status:400});
      const xr=await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:"Bearer "+token.access_token,"Content-Type":"application/json"},body:JSON.stringify({text:draft.content,quote_tweet_id:draft.in_reply_to_tweet_id})});
      const xd=await xr.json().catch(()=>({}));
      if (!xr.ok) return Response.json({ok:false,message:xd?.detail||xd?.title||"X could not send the reply."},{status:xr.status});
      const replyId=xd?.data?.id||null;
      await env.DB.prepare("UPDATE x_reply_drafts SET status='sent',x_reply_id=?,sent_at=CURRENT_TIMESTAMP WHERE id=?").bind(replyId,id).run();
      return Response.json({ok:true,status:"sent",x_reply_id:replyId});
    }

    // =========================================================
    // X AGENT DRAFTS + APPROVAL/PUBLISH
    // =========================================================

    if (url.pathname === "/api/admin/x/topics" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok: false, message: "Workers AI is not connected." }, { status: 500 });
      try {
        const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            {
              role: "system",
              content: "Generate 5 fresh topic ideas for Kendra Bexly's X account. Ideas should feel warm, personable, playful, confident, conversational, and human. Mix everyday thoughts, light conversation starters, positive energy, lifestyle, and tasteful flirty personality. Do not invent personal facts, dates, locations, events, or experiences. No hashtags. Return exactly 5 short ideas, one per line, with no numbering or bullets."
            },
            { role: "user", content: "Give me five new X post topics." }
          ],
          max_tokens: 220,
          temperature: 0.95
        });
        const raw = String(aiResult?.response || aiResult?.result?.response || "").trim();
        const topics = raw.split(/\n+/).map(x => x.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);
        if (!topics.length) throw new Error("Workers AI returned no topic ideas.");
        return Response.json({ ok: true, topics });
      } catch (error) {
        console.error("X topic generation failed:", error);
        const detail = String(error?.message || error?.cause?.message || error || "Unknown Workers AI error").slice(0, 600);
        return Response.json({ ok: false, message: "Workers AI error: " + detail, error: detail }, { status: 502 });
      }
    }

    if (url.pathname === "/api/admin/x/series/generate" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok:false, message:"Workers AI is not connected." }, { status:500 });
      const data=await request.json();
      const topic=String(data.topic||"").trim();
      if(!topic) return Response.json({ok:false,message:"Add a series topic first."},{status:400});
      if(topic.length>1000) return Response.json({ok:false,message:"Keep the topic under 1,000 characters."},{status:400});
      try {
        const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{
          messages:[
            {role:"system",content:"Create exactly 5 distinct but connected X posts for Kendra Bexly around one topic. The posts should feel like an ongoing natural conversation, not repetitive variations. Sound warm, personable, confident, conversational, and human. Each post must stand on its own. Avoid corporate language, clickbait, excessive emojis, and unnecessary hashtags. Never invent personal facts. Return only valid JSON: an array of 5 strings, with no markdown or explanation."},
            {role:"user",content:"Topic: "+topic}
          ],max_tokens:1400,temperature:0.85
        });
        let raw=String(ai?.response||ai?.result?.response||"").trim().replace(/^\`\`\`(?:json)?/i,"").replace(/\`\`\`$/,"").trim();
        let posts;
        try{posts=JSON.parse(raw);}catch{posts=raw.split(/\n+/).map(x=>x.replace(/^\s*(?:\d+[.)-]?|[-*])\s*/,"").trim()).filter(Boolean);}
        posts=(Array.isArray(posts)?posts:[]).map(x=>String(x).trim()).filter(Boolean).slice(0,5);
        if(posts.length!==5) throw new Error("Workers AI did not return five usable posts.");
        return Response.json({ok:true,posts});
      } catch(error) {
        const detail=String(error?.message||error||"Unknown Workers AI error").slice(0,600);
        return Response.json({ok:false,message:"Workers AI error: "+detail},{status:502});
      }
    }

    if (url.pathname === "/api/admin/x/generate" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok: false, message: "Workers AI is not connected." }, { status: 500 });
      const data = await request.json();
      const idea = String(data.idea || "").trim();
      if (!idea) return Response.json({ ok: false, message: "Add a topic or idea first." }, { status: 400 });
      if (idea.length > 1000) return Response.json({ ok: false, message: "Keep the idea under 1,000 characters." }, { status: 400 });

      try {
        const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            {
              role: "system",
              content: "Write one natural X post for Kendra Bexly. Sound warm, personable, confident, conversational, and human. Avoid corporate language, clickbait, hashtags unless clearly useful, and excessive emojis. Never claim facts not supplied by the user. Return only the finished post, with no labels, quotation marks, explanations, or alternatives. Write a complete, natural thought. It may be longer than 280 characters when needed, but stay concise and avoid filler."
            },
            { role: "user", content: idea }
          ],
          max_tokens: 500,
          temperature: 0.8
        });
        let content = String(aiResult?.response || aiResult?.result?.response || "").trim();
        content = content.replace(/^["“]|["”]$/g, "").trim();
        if (!content) throw new Error("Workers AI returned an empty response.");

        // Generation only previews the post. The user explicitly saves it
        // through the existing Save Draft action after reviewing/editing.
        return Response.json({ ok: true, content });
      } catch (error) {
        console.error("X AI generation failed:", error);
        const detail = String(error?.message || error?.cause?.message || error || "Unknown Workers AI error").slice(0, 600);
        return Response.json({
          ok: false,
          message: "Workers AI error: " + detail,
          error: detail
        }, { status: 502 });
      }
    }

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
      if (!content) return Response.json({ ok: false, message: "Draft cannot be empty." }, { status: 400 });
      const row = await env.DB.prepare("SELECT status FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!row) return Response.json({ ok: false, message: "Draft not found." }, { status: 404 });
      if (row.status === "published") return Response.json({ ok: false, message: "Published posts cannot be edited here." }, { status: 400 });
      await env.DB.prepare("UPDATE x_post_drafts SET content = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(content, id).run();
      return Response.json({ ok: true, status: "draft" });
    }

    if (url.pathname.startsWith("/api/admin/x/drafts/") && request.method === "DELETE") {
      const id = Number(url.pathname.split("/").pop());
      if (!Number.isInteger(id) || id < 1) return Response.json({ ok: false, message: "Invalid draft ID." }, { status: 400 });
      const row = await env.DB.prepare("SELECT id, status FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!row) return Response.json({ ok: false, message: "Draft not found." }, { status: 404 });
      // Deleting a published item only removes it from this dashboard history.\n      // It does not delete the already-published post from X.\n      await env.DB.prepare("DELETE FROM x_post_drafts WHERE id = ?").bind(id).run();
      return Response.json({ ok: true });
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

    if (url.pathname === "/api/admin/x/delete-tweet" && request.method === "POST") {
      const data = await request.json();
      const id = Number(data.id);
      if (!Number.isInteger(id) || id < 1) return Response.json({ ok:false, message:"Invalid post ID." }, { status:400 });

      const draft = await env.DB.prepare("SELECT id, status, x_post_id FROM x_post_drafts WHERE id = ?").bind(id).first();
      if (!draft) return Response.json({ ok:false, message:"Post not found." }, { status:404 });
      if (draft.status !== "published" || !draft.x_post_id) return Response.json({ ok:false, message:"This item does not have a published X post to delete." }, { status:400 });

      let row = await env.DB.prepare("SELECT access_token, refresh_token, expires_at, scope FROM x_oauth_tokens WHERE id = 1").first();
      if (!row) return Response.json({ ok:false, message:"X is not connected." }, { status:400 });
      let accessToken = row.access_token;
      const now = Math.floor(Date.now() / 1000);
      if (Number(row.expires_at || 0) <= now + 300) {
        if (!row.refresh_token) return Response.json({ ok:false, message:"Reconnect X before deleting this tweet." }, { status:401 });
        const refreshBody = new URLSearchParams({ grant_type:"refresh_token", refresh_token:row.refresh_token, client_id:env.X_CLIENT_ID });
        const basic = btoa(String(env.X_CLIENT_ID) + ":" + String(env.X_CLIENT_SECRET));
        const rr = await fetch("https://api.x.com/2/oauth2/token", { method:"POST", headers:{ Authorization:"Basic " + basic, "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8" }, body:refreshBody.toString() });
        if (!rr.ok) return Response.json({ ok:false, message:"X connection expired. Please reconnect." }, { status:401 });
        const tokens = await rr.json();
        accessToken = tokens.access_token;
        await env.DB.prepare("UPDATE x_oauth_tokens SET access_token=?, refresh_token=?, expires_at=?, scope=?, updated_at=CURRENT_TIMESTAMP WHERE id=1")
          .bind(accessToken, tokens.refresh_token || row.refresh_token, now + Number(tokens.expires_in || 7200), tokens.scope || row.scope || null).run();
      }

      const xr = await fetch("https://api.x.com/2/tweets/" + encodeURIComponent(draft.x_post_id), {
        method:"DELETE",
        headers:{ Authorization:"Bearer " + accessToken }
      });
      const xdata = await xr.json().catch(() => ({}));
      if (!xr.ok) {
        console.error("X delete failed:", xr.status, xdata);
        return Response.json({ ok:false, message:xdata?.detail || xdata?.title || "X could not delete the tweet." }, { status:xr.status });
      }

      await env.DB.prepare("DELETE FROM x_post_drafts WHERE id = ?").bind(id).run();
      return Response.json({ ok:true, deleted:true });
    }

    async function ensureXScheduledTable() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS x_scheduled_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          draft_id INTEGER NOT NULL UNIQUE,
          scheduled_for TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    }

    if (url.pathname === "/api/admin/x/scheduled" && request.method === "GET") {
      await ensureXScheduledTable();
      const rows=await env.DB.prepare(`
        SELECT s.id,s.draft_id,s.scheduled_for,s.status,s.created_at,d.content
        FROM x_scheduled_posts s JOIN x_post_drafts d ON d.id=s.draft_id
        WHERE s.status='scheduled' ORDER BY s.scheduled_for ASC
      `).all();
      return Response.json({ok:true,scheduled:rows.results||[]});
    }

    if (url.pathname === "/api/admin/x/schedule" && request.method === "POST") {
      await ensureXScheduledTable();
      const data=await request.json(),draftId=Number(data.id),scheduledFor=String(data.scheduled_for||"").trim();
      if(!Number.isInteger(draftId)||draftId<1||!scheduledFor) return Response.json({ok:false,message:"Choose a valid date and time."},{status:400});
      const when=Date.parse(scheduledFor);
      if(!Number.isFinite(when)||when<=Date.now()+30000) return Response.json({ok:false,message:"Schedule the post for a future time."},{status:400});
      const draft=await env.DB.prepare("SELECT id,status FROM x_post_drafts WHERE id=?").bind(draftId).first();
      if(!draft) return Response.json({ok:false,message:"Draft not found."},{status:404});
      if(draft.status!=="approved") return Response.json({ok:false,message:"Approve this draft before scheduling it."},{status:400});
      await env.DB.prepare(`INSERT INTO x_scheduled_posts(draft_id,scheduled_for,status,updated_at) VALUES(?,?,'scheduled',CURRENT_TIMESTAMP)
        ON CONFLICT(draft_id) DO UPDATE SET scheduled_for=excluded.scheduled_for,status='scheduled',updated_at=CURRENT_TIMESTAMP`).bind(draftId,new Date(when).toISOString()).run();
      return Response.json({ok:true,status:"scheduled",scheduled_for:new Date(when).toISOString()});
    }

    if (url.pathname === "/api/admin/x/schedule/cancel" && request.method === "POST") {
      await ensureXScheduledTable();
      const data=await request.json(),id=Number(data.id);
      await env.DB.prepare("UPDATE x_scheduled_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='scheduled'").bind(id).run();
      return Response.json({ok:true});
    }

    if (url.pathname === "/api/admin/x/schedule/reschedule" && request.method === "POST") {
      await ensureXScheduledTable();
      const data=await request.json(),id=Number(data.id),when=Date.parse(String(data.scheduled_for||""));
      if(!Number.isInteger(id)||id<1||!Number.isFinite(when)||when<=Date.now()+30000) return Response.json({ok:false,message:"Choose a valid future date and time."},{status:400});
      await env.DB.prepare("UPDATE x_scheduled_posts SET scheduled_for=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='scheduled'").bind(new Date(when).toISOString(),id).run();
      return Response.json({ok:true,scheduled_for:new Date(when).toISOString()});
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

  async function ensureNewsletterSubscribersTable() {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at TEXT
      )
    `).run();
  }

  // Public newsletter signup
  if (url.pathname === "/api/newsletter/subscribe" && request.method === "POST") {
    await ensureNewsletterSubscribersTable();
    const data = await request.json();
    const email = String(data.email || "").trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return Response.json({ ok: false, message: "Please enter a valid email address." }, { status: 400 });
    }
    const existing = await env.DB.prepare(
      "SELECT id, status FROM newsletter_subscribers WHERE LOWER(email) = LOWER(?)"
    ).bind(email).first();
    if (existing) {
      if (existing.status !== "active") {
        await env.DB.prepare(
          "UPDATE newsletter_subscribers SET status = 'active', unsubscribed_at = NULL WHERE id = ?"
        ).bind(existing.id).run();
      }
      return Response.json({ ok: true, message: "You're on the list. Thank you." });
    }
    await env.DB.prepare(
      "INSERT INTO newsletter_subscribers (email, status) VALUES (?, 'active')"
    ).bind(email).run();
    return Response.json({ ok: true, message: "You're on the list. Thank you." });
  }

  // Admin subscriber list
  if (url.pathname === "/api/admin/newsletter/subscribers" && request.method === "GET") {
    await ensureNewsletterSubscribersTable();
    const result = await env.DB.prepare(
      "SELECT id, email, status FROM newsletter_subscribers ORDER BY id DESC LIMIT 500"
    ).all();
    const subscribers = result.results || [];
    const activeCountRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM newsletter_subscribers WHERE status = 'active'"
    ).first();
    return Response.json({
      ok: true,
      count: Number(activeCountRow?.count || 0),
      subscribers
    });
  }

  // Send an approved newsletter through Resend
  if (url.pathname.match(/^\/api\/admin\/newsletter\/drafts\/\d+\/send$/) && request.method === "POST") {
    if (!env.RESEND_API_KEY) {
      return Response.json({ ok: false, message: "Email delivery is not configured." }, { status: 500 });
    }
    await ensureNewsletterTable();
    await ensureNewsletterSubscribersTable();

    const id = Number(url.pathname.split("/").slice(-2, -1)[0]);
    const draft = await env.DB.prepare(
      "SELECT id, subject, content, blog_title, blog_content, special_offer, status FROM newsletter_drafts WHERE id = ?"
    ).bind(id).first();

    if (!draft) return Response.json({ ok: false, message: "Newsletter draft not found." }, { status: 404 });
    if (draft.status !== "approved") {
      return Response.json({ ok: false, message: "Approve the newsletter before sending it." }, { status: 400 });
    }

    const result = await env.DB.prepare(
      "SELECT email FROM newsletter_subscribers WHERE status = 'active' ORDER BY id ASC"
    ).all();
    const subscribers = result.results || [];
    if (!subscribers.length) {
      return Response.json({ ok: false, message: "There are no active subscribers." }, { status: 400 });
    }

    const esc = (value) => String(value || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    const para = (value) => esc(value).replace(/\n/g, "<br>");
    const html = `<!doctype html><html><body style="margin:0;background:#f6f1e8;color:#29282d;font-family:Georgia,serif;">
      <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
        <div style="background:#fffdf9;border:1px solid #ded7cd;padding:34px;">
          <div style="font:12px Arial,sans-serif;letter-spacing:3px;color:#77736f;">KENDRA BEXLY</div>
          <h1 style="font-weight:500;">${esc(draft.subject)}</h1>
          <p style="line-height:1.65;">${para(draft.content)}</p>
          ${draft.blog_title ? `<h2 style="font-weight:500;">${esc(draft.blog_title)}</h2>` : ""}
          ${draft.blog_content ? `<p style="line-height:1.65;">${para(draft.blog_content)}</p>` : ""}
          ${draft.special_offer ? `<div style="margin-top:28px;padding:20px;background:#eee7dc;"><strong>This Month's Special</strong><p style="line-height:1.65;">${para(draft.special_offer)}</p></div>` : ""}
        </div>
      </div>
    </body></html>`;

    let sent = 0;
    const failed = [];
    for (const subscriber of subscribers) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.RESEND_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "Kendra Bexly <newsletter@kendrabexly.com>",
            to: [subscriber.email],
            subject: draft.subject,
            html
          })
        });
        if (!response.ok) {
          failed.push(subscriber.email);
          console.error("Resend delivery failed:", response.status, await response.text());
        } else {
          sent++;
        }
      } catch (error) {
        failed.push(subscriber.email);
        console.error("Resend delivery error:", error);
      }
    }

    if (failed.length) {
      return Response.json({
        ok: false,
        message: `Sent to ${sent} subscriber(s), but ${failed.length} delivery request(s) failed. The draft remains approved so you can retry.`,
        sent,
        failed: failed.length
      }, { status: 502 });
    }

    await env.DB.prepare(
      "UPDATE newsletter_drafts SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'"
    ).bind(id).run();

    return Response.json({ ok: true, message: `Newsletter sent to ${sent} subscriber(s).`, sent });
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

  // Delete an unsent newsletter draft
  if (
    url.pathname.startsWith("/api/admin/newsletter/drafts/") &&
    request.method === "DELETE"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ ok: false, message: "Invalid newsletter ID." }, { status: 400 });
    }
    const existing = await env.DB.prepare(
      "SELECT status FROM newsletter_drafts WHERE id = ?"
    ).bind(id).first();
    if (!existing) {
      return Response.json({ ok: false, message: "Newsletter draft not found." }, { status: 404 });
    }
    if (existing.status === "sent") {
      return Response.json({ ok: false, message: "Sent newsletters cannot be deleted." }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM newsletter_drafts WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
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
  // Delete an unsent newsletter draft
  if (
    url.pathname.startsWith("/api/admin/newsletter/drafts/") &&
    request.method === "DELETE"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.pathname.split("/").pop());
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ ok: false, message: "Invalid newsletter ID." }, { status: 400 });
    }
    const existing = await env.DB.prepare(
      "SELECT id, status FROM newsletter_drafts WHERE id = ?"
    ).bind(id).first();
    if (!existing) {
      return Response.json({ ok: false, message: "Newsletter draft not found." }, { status: 404 });
    }
    if (existing.status === "sent") {
      return Response.json({ ok: false, message: "Sent newsletters cannot be deleted." }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM newsletter_drafts WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
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
