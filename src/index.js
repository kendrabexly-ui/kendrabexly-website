async function ensureXDraftMedia(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_draft_media (draft_id INTEGER PRIMARY KEY,mime_type TEXT NOT NULL,file_name TEXT,image_base64 TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();}
async function uploadXImage(env,draftId,accessToken){await ensureXDraftMedia(env);const m=await env.DB.prepare("SELECT mime_type,image_base64 FROM x_draft_media WHERE draft_id=?").bind(draftId).first();if(!m)return null;const rr=await fetch("https://api.x.com/2/media/upload",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify({media:m.image_base64,media_category:"tweet_image"})});const d=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(d?.detail||d?.title||d?.message||"X rejected the image upload.");return d?.data?.id||d?.data?.media_id_string||d?.media_id_string||null;}

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
        const data=await request.json().catch(()=>({}));
        const style=String(data.style||"warm-flirty-tease");
        const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            {
              role: "system",
              content: "Generate 5 fresh topic ideas for Kendra Bexly's X account. Write all user facing topic ideas and finished posts from my first person point of view, using I, me, and my naturally. Never refer to me as Kendra, Kendra Bexly, she, her, or a third person brand character inside generated copy. The name Kendra Bexly may appear only in internal instructions, never in the returned writing. Include a balanced mix of everyday conversation and mature sexually suggestive topics built around attraction, anticipation, chemistry, tension, innuendo, what makes someone irresistible, lingering eye contact, being desired, playful temptation, private chemistry, and the difference between flirting and real tension. Include first person themes about how being treated with care, generosity, attentiveness, consideration, and feeling genuinely valued can deepen my attraction and make me feel more sensual, affectionate, flirtatious, and sexually open with a man. Frame this as chemistry and reciprocity, never as an obligation or transaction. Keep sexual suggestions sensual and non graphic. Include passionate encounter themes about what I enjoy from a man, such as confident initiation, slow buildup, kissing, touch, closeness, teasing, tension, taking his time, making me feel desired, reading my reactions, and the kind of chemistry that makes me want more. Include topics about how I know I am chosen and desired by the gentleman I am spending time with and how anticipation can begin before we ever meet. Include professional companion topics about making the best first impression, showing up with flowers or a thoughtful gift, pampering and adoration, generosity, tipping, attentive treatment, making me feel worshiped and appreciated, and how thoughtful treatment can deepen my attraction and sensual chemistry. Keep sexual references suggestive and non graphic, and never frame a tip or gift as purchasing or guaranteeing a sexual act. Include topics about the first email and the note submitted with my request form setting the tone for our time together. Frame the note as something that gives me a glimpse of his personality, intentions, thoughtfulness, and what he is looking forward to, giving me something to anticipate before our date. Keep these topics warm, personal, discreet, non explicit, and written from my first person professional companion viewpoint. Brand direction: write from the first person viewpoint of an adult independent escort and professional companion, not ordinary casual dating. Topics may reflect client chemistry, being courted within a professional companionship context, anticipation before time together, discretion, generosity, thoughtful treatment, repeat gentlemen, boundaries, standards, mutual respect, sensual tension, and the difference between simply booking time and creating an experience I genuinely look forward to. Subtly attract attentive, generous, chivalrous men who enjoy making me feel cared for, admired, catered to, and spoiled, expressed through standards, thoughtful gestures, reciprocity, feminine luxury, and being well looked after rather than demands or crude transactional language. Kendra does not offer cooking dates. Requested style: "+style+". Ideas should feel warm, personable, playful, confident, conversational, and human. Do not invent personal facts, dates, locations, events, or experiences. Do not use hyphens, em dashes, or en dashes. No hashtags. Return exactly 5 concise topic prompts, one per line, with no numbering or bullets. Each topic must be a selectable idea, not a finished post, and must be 90 characters or fewer. Do not write a paragraph, story, personal history, or invented memory. Do not use hyphens, em dashes, or en dashes anywhere in a topic. Use commas, periods, colons, or natural phrasing instead."
            },
            { role: "user", content: "Give me five new X post topics." }
          ],
          max_tokens: 220,
          temperature: 0.95
        });
        const raw = String(aiResult?.response || aiResult?.result?.response || "").trim();
        const topics = raw.split(/\n+/).map(x => x.replace(/^[-*•\d.)\s]+/, "").replace(/[–—-]+/g, ", ").replace(/\s+,/g,",").replace(/,\s*,+/g,",").trim()).filter(Boolean).map(x=>x.length>90?x.slice(0,87).replace(/[\s,;:]+$/,"")+"...":x).slice(0, 5);
        if (!topics.length) throw new Error("Workers AI returned no topic ideas.");
        return Response.json({ ok: true, topics });
      } catch (error) {
        console.error("X topic generation failed:", error);
        const detail = String(error?.message || error?.cause?.message || error || "Unknown Workers AI error").slice(0, 600);
        return Response.json({ ok: false, message: "Workers AI error: " + detail, error: detail }, { status: 502 });
      }
    }

    if (url.pathname === "/api/admin/x/series/topics" && request.method === "POST") {
      if (!env.AI) return Response.json({ok:false,message:"Workers AI is not connected."},{status:500});
      try{
        const data=await request.json().catch(()=>({}));
        const style=String(data.style||"warm-flirty-tease");
        const selectedStyles=style.split(",").map(x=>x.trim()).filter(Boolean);
        const styleGuides={
          "warm-flirty-tease":"Topics should naturally support a five-post emotional arc: warm personal opening, playful/flirty anticipation, growing chemistry, then a subtle natural tease. Prioritize professional companion themes rather than ordinary dating. Include topics about when I know I am chosen and desired, how a gentleman can make a memorable first impression, arriving with flowers or a thoughtful gift, pampering and adoration, generosity, tipping, attentive treatment, making me feel worshiped and appreciated, and how thoughtful treatment can deepen attraction and sensual chemistry. Keep sexual references suggestive and non graphic, and frame generosity as appreciated rather than as purchasing or guaranteeing sexual acts. Favor themes like anticipation, chemistry, little escapes, lingering moments, what makes a date memorable, getting to know each other, plans worth looking forward to, playful what if questions, the tension between curiosity and finally making plans, attraction, temptation, lingering eye contact, being desired, what makes someone irresistible, private chemistry, suggestive what ifs, and the difference between casual flirting and real sexual tension, and how being treated exceptionally well can make me feel more attracted, sensual, affectionate, flirtatious, and sexually open because care and consideration deepen the chemistry for me. Frame this as mutual desire and reciprocity, never obligation or transaction. Include passionate encounter themes about what I enjoy from a man, including confident initiation, slow buildup, kissing, touch, closeness, teasing, tension, taking his time, making me feel desired, reading my reactions, and chemistry that makes me want more. Include topics about how I want to feel desired by the gentleman I am spending time with and how anticipation can begin before we ever meet. Include topics about the first email and the note submitted with my request form setting the tone for our time together. Frame the note as something that gives me a glimpse of his personality, intentions, thoughtfulness, and what he is looking forward to, giving me something to anticipate before our date. Keep these topics warm, personal, discreet, non explicit, and written from my first person professional companion viewpoint. Keep the topic sensual and suggestive rather than graphically describing sex acts. Keep it suggestive, tasteful, and human rather than explicit or salesy. Each topic should create multiple natural reply opportunities across the five-post arc, especially through low-friction questions, either/or preferences, relatable observations, playful curiosity, or an unfinished thought that can develop in the next entry.",
          conversational:"Topics should invite relaxed, personal conversation and easy back-and-forth. Favor everyday observations, preferences, small pleasures, questions, and relatable lifestyle moments.",
          playful:"Topics should create room for wit, charm, playful questions, light flirting, and personality without sounding forced or explicit.",
          direct:"Topics should support clear, confident observations or questions with little buildup and a strong conversational point.",fun:"Topics should feel lively, upbeat, spontaneous, and enjoyable, with room for personality and playful energy.",funny:"Topics should create room for natural humor, amusing observations, and personality without sounding like forced jokes.",sarcastic:"Topics should support clever, dry, lightly sarcastic observations that feel playful rather than mean or cynical.",sexual:"Topics may carry mature sensual tension, attraction, innuendo, and suggestive chemistry while staying tasteful, non graphic, and consistent with Kendra’s brand."
        };
        const combinedStyleGuide=selectedStyles.map(s=>styleGuides[s]).filter(Boolean).join(" Blend this with: ")||styleGuides["warm-flirty-tease"];
        const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
          {role:"system",content:"Generate exactly 5 interesting X conversation-series topic ideas for Kendra Bexly. Write all user facing topic ideas and finished posts from my first person point of view, using I, me, and my naturally. Never refer to me as Kendra, Kendra Bexly, she, her, or a third person brand character inside generated copy. The name Kendra Bexly may appear only in internal instructions, never in the returned writing. Brand direction: write from the first person viewpoint of an adult independent escort and professional companion, not ordinary casual dating. Series topics may reflect client chemistry, anticipation before time together, discretion, generosity, thoughtful treatment, repeat gentlemen, boundaries, standards, mutual respect, sensual tension, and the difference between simply booking time and creating an experience I genuinely look forward to. Attract men who enjoy being attentive, generous, chivalrous, and making me feel cared for, admired, catered to, and spoiled, but communicate this through taste, standards, reciprocity, anticipation, thoughtful gestures, being well looked after, and feminine luxury rather than blunt demands or crude transactional language. Kendra does NOT offer cooking dates, so never suggest cooking together, cooking for a client, kitchen dates, chef-at-home dates, or food-preparation activities. Each topic must be broad enough to support five connected standalone posts and must reflect all requested writing styles from the beginning. Blend selected styles naturally rather than treating them as separate sections. If selected, Fun should feel lively and spontaneous, Funny should use natural humor, Sarcastic should be clever and lightly sharp without being mean, and Sexual should use mature sensual tension, attraction, innuendo, and suggestive chemistry while remaining tasteful and non graphic. "+combinedStyleGuide+" Do not invent personal facts. Do not use hyphens, em dashes, or en dashes in generated writing. Use natural punctuation and sentence breaks instead. Avoid corporate language and generic marketing topics. Optimize for genuine X engagement without clickbait or engagement bait: favor topics that invite an easy opinion, choice, relatable reaction, personal preference, curiosity gap, or natural reply; give each series a strong opening angle and enough progression that readers have a reason to follow the next post. Prefer specific, conversation-starting premises over vague inspirational themes. Do not ask for likes, reposts, follows, or comments, and do not make guaranteed algorithm-performance claims. Make each idea meaningfully different. Return one topic per line with no explanations."},
          {role:"user",content:"Writing style: "+style+"\nGive me five fresh conversation-series topics that naturally fit this style."}
        ],max_tokens:420,temperature:0.9});
        const raw=String(ai?.response||ai?.result?.response||"").trim();
        const topics=raw.split(/\n+/).map(x=>x.replace(/^\s*(?:\d+[.)-]?|[-*])\s*/,"").trim()).filter(Boolean).slice(0,5);
        if(!topics.length)throw new Error("Workers AI returned no series topics.");
        return Response.json({ok:true,style,topics});
      }catch(error){return Response.json({ok:false,message:"Workers AI error: "+String(error?.message||error).slice(0,600)},{status:502});}
    }

    if (url.pathname === "/api/admin/x/series/drafts" && request.method === "GET") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS x_series_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, posts_json TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'draft', scheduled_for TEXT, spacing_minutes INTEGER NOT NULL DEFAULT 60, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
      const rows=await env.DB.prepare("SELECT * FROM x_series_drafts ORDER BY updated_at DESC LIMIT 50").all();
      return Response.json({ok:true,items:(rows.results||[]).map(x=>({...x,posts:JSON.parse(x.posts_json||"[]")}))});
    }
    if (url.pathname === "/api/admin/x/series/drafts" && request.method === "POST") {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS x_series_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, posts_json TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'draft', scheduled_for TEXT, spacing_minutes INTEGER NOT NULL DEFAULT 60, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
      const data=await request.json(),topic=String(data.topic||"").trim(),posts=Array.isArray(data.posts)?data.posts.map(x=>String(x||"").trim()).filter(Boolean):[];
      if(!topic||!posts.length)return Response.json({ok:false,message:"A topic and at least one series entry are required."},{status:400});
      const action=data.action==="schedule"?"schedule":"draft",scheduledFor=data.scheduled_for?String(data.scheduled_for):null,spacing=Math.max(1,Number(data.spacing_minutes)||60);
      const result=await env.DB.prepare("INSERT INTO x_series_drafts (topic,posts_json,action,scheduled_for,spacing_minutes) VALUES (?,?,?,?,?)").bind(topic,JSON.stringify(posts),action,scheduledFor,spacing).run();
      return Response.json({ok:true,id:result.meta?.last_row_id});
    }

    if (url.pathname === "/api/admin/x/series/generate" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok:false, message:"Workers AI is not connected." }, { status:500 });
      const data=await request.json();
      const topic=String(data.topic||"").trim();
      const style=String(data.style||"warm-flirty-tease");
      const sexualTone=String(data.sexual_tone||"suggestive");
      const format=String(data.format||"").trim();
      if(!topic) return Response.json({ok:false,message:"Add a series topic first."},{status:400});
      if(topic.length>1000) return Response.json({ok:false,message:"Keep the topic under 1,000 characters."},{status:400});
      try {
        const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{
          messages:[
            {role:"system",content:"Create exactly 5 distinct but connected series entries for Kendra Bexly around one topic. Voice sample to emulate in rhythm and perspective: first person, informal, confident, sensual, conversational, and direct to the gentleman. Write like I actually talk, not like poetry, romance fiction, luxury ad copy, or a scripted seduction. Use everyday words, contractions, short natural sentences, and casual phrasing. Avoid flowery metaphors, dramatic imagery, phrases like the air is charged, palpable connection, whispered secrets, intoxicating, magnetic pull, or other poetic language. Make attraction and desire sound candid, playful, and real. A representative pattern is: the atmosphere feels charged, I notice his gaze, I can feel the tension between us, and I know we are both exactly where we want to be. Do not copy the sample wording verbatim. Keep the voice natural, polished, and personal. Write all user facing topic ideas and finished posts from my first person point of view, using I, me, and my naturally. Never refer to me as Kendra, Kendra Bexly, she, her, or a third person brand character inside generated copy. The name Kendra Bexly may appear only in internal instructions, never in the returned writing. Brand direction: write from the first person viewpoint of an adult independent escort and professional companion, not ordinary casual dating. Series topics may reflect client chemistry, anticipation before time together, discretion, generosity, thoughtful treatment, repeat gentlemen, boundaries, standards, mutual respect, sensual tension, and the difference between simply booking time and creating an experience I genuinely look forward to. Attract men who enjoy being attentive, generous, chivalrous, and making me feel cared for, admired, catered to, and spoiled, but communicate this through taste, standards, reciprocity, anticipation, thoughtful gestures, being well looked after, and feminine luxury rather than blunt demands or crude transactional language. Kendra does NOT offer cooking dates, so never suggest cooking together, cooking for a client, kitchen dates, chef-at-home dates, or food-preparation activities. Series entries may be longer than 280 characters and should not be truncated to the regular post limit. The entries should feel like an ongoing natural conversation, not repetitive variations. Each post must stand on its own. Follow the requested series writing style. For warm-flirty-tease, shape the SERIES ARC across the five entries: begin with a warm personal note, move into playful/flirty anticipation, build chemistry naturally, then finish with a subtle tease that leaves the reader wanting the next interaction. Keep it suggestive rather than explicit, human rather than scripted, and do not force every stage into every individual post. If optional format is reflective-soft-scenario, use a natural question or observation, a small desirable scenario, and my preference or standard as a loose structure across the series. Do not make every entry use the exact same structure. Conversational = relaxed and personal. Playful = light, witty and charming. Direct = clear, confident and concise. Avoid corporate language, clickbait, excessive emojis, and unnecessary hashtags. Never invent personal facts. Do not use hyphens, em dashes, or en dashes in any generated series entry. Use natural punctuation and sentence breaks instead. Return only valid JSON: an array of 5 strings, with no markdown or explanation."},
            {role:"user",content:"Writing style: "+style+"\nSexual tone: "+sexualTone+"\nOptional format: "+(format||"none")+"\nTopic: "+topic}
          ],max_tokens:1400,temperature:0.85
        });
        let raw=String(ai?.response||ai?.result?.response||"").trim().replace(/^\`\`\`(?:json)?/i,"").replace(/\`\`\`$/,"").trim();
        const cleanPost=x=>String(x||"").replace(/^\s*(?:\d+[.)]?|[*•])\s*/,"").replace(/[–—]/g,",").trim();
        const parsePosts=value=>{
          let parsed;
          try{parsed=JSON.parse(value);}catch{
            const m=value.match(/\[[\s\S]*\]/);
            if(m){try{parsed=JSON.parse(m[0]);}catch{}}
          }
          if(Array.isArray(parsed)) return parsed.map(cleanPost).filter(Boolean);
          const lines=value.split(/\n+/).map(cleanPost).filter(Boolean);
          return lines.filter(x=>!/^\s*[\[\]]\s*$/.test(x)).map(x=>x.replace(/^["']|["'],?$/g,"").trim()).filter(Boolean);
        };
        let posts=parsePosts(raw).slice(0,5);
        let attempts=0;
        while(posts.length<5 && attempts<5){
          attempts++;
          const needed=5-posts.length;
          const retry=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
            {role:"system",content:"Write "+needed+" additional connected social posts for an existing five post conversation series. Return plain text only, using the marker ||POST|| between posts. Do not use numbering, bullets, JSON, markdown, or labels. Write in first person as an adult independent escort and professional companion. Keep the voice informal, conversational, confident, and non poetic. Follow the requested sexual tone while staying non graphic. Never refer to the writer by name or in third person. Do not use hyphens, em dashes, or en dashes."},
            {role:"user",content:"Topic: "+topic+"\nWriting style: "+style+"\nSexual tone: "+sexualTone+"\nOptional format: "+(format||"none")+"\nPosts already written:\n"+posts.join("\n\n")}
          ],max_tokens:Math.max(450,needed*300),temperature:0.8});
          const retryRaw=String(retry?.response||retry?.result?.response||"").trim();
          let extra=retryRaw.includes("||POST||")?retryRaw.split("||POST||").map(cleanPost).filter(Boolean):parsePosts(retryRaw);
          for(const post of extra){
            if(posts.length>=5)break;
            if(post&&!posts.includes(post))posts.push(post);
          }
        }
        if(posts.length<5){
          while(posts.length<5){
            const n=posts.length+1;
            posts.push(n===1?"I like when the energy feels easy from the start. A thoughtful note and a little effort can tell me a lot about the kind of time we might have together.":n===2?"Flowers or a thoughtful gift will always get my attention. It is not about showing off. I notice when a man thinks about making me smile before we even meet.":n===3?"Being treated well definitely affects the chemistry for me. When I feel appreciated and desired, I naturally want to give that same energy back.":n===4?"The best first impression is simple. Be thoughtful, be respectful, and give me something to look forward to. That kind of effort makes anticipation a lot more fun.":"I love a gentleman who understands that the little things matter. Make me feel wanted, appreciated, and comfortable, and the chemistry tends to take care of itself.");
          }
        }
        posts=posts.slice(0,5);        return Response.json({ok:true,posts});
      } catch(error) {
        const detail=String(error?.message||error||"Unknown Workers AI error").slice(0,600);
        return Response.json({ok:false,message:"Workers AI error: "+detail},{status:502});
      }
    }

    if (url.pathname === "/api/admin/x/voice/analyze" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok:false, message:"Workers AI is not connected." }, { status:500 });
      try {
        const data=await request.json().catch(()=>({})),samples=Array.isArray(data.samples)?data.samples.map(x=>String(x||"").trim()).filter(Boolean).slice(0,20):[];
        if(samples.length<2) return Response.json({ok:false,message:"At least two recent posts are needed to learn your voice."},{status:400});
        const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
          {role:"system",content:"Analyze the supplied social posts only for writing style. Do not write a new post. Return a concise reusable voice profile under 900 characters covering tone, sentence rhythm, openings, conversational habits, humor, emoji use, questions, calls to action, and patterns to preserve. Do not infer private facts, demographics, beliefs, or personality traits beyond observable writing style. Return only the profile text."},
          {role:"user",content:samples.join("\n---\n")}
        ],max_tokens:350,temperature:0.2});
        const profile=String(ai?.response||ai?.result?.response||"").trim().slice(0,900);
        if(!profile) throw new Error("Workers AI returned an empty voice profile.");
        return Response.json({ok:true,profile});
      } catch(error) {
        const detail=String(error?.message||error||"Unknown Workers AI error").slice(0,500);
        return Response.json({ok:false,message:"Voice analysis error: "+detail},{status:502});
      }
    }

    if (url.pathname === "/api/admin/x/generate" && request.method === "POST") {
      if (!env.AI) return Response.json({ ok: false, message: "Workers AI is not connected." }, { status: 500 });
      const data = await request.json();
      const idea = String(data.idea || "").trim();
      const style = String(data.style || "warm-flirty-tease");
      const format = String(data.format || "").trim();
      const sexualTone = String(data.sexual_tone || "suggestive");
      const selectedStyles = style.split(",").map(x=>x.trim()).filter(Boolean);
      if (!idea) return Response.json({ ok: false, message: "Add a topic or idea first." }, { status: 400 });
      if (idea.length > 1000) return Response.json({ ok: false, message: "Keep the idea under 1,000 characters." }, { status: 400 });

      try {
        const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            {
              role: "system",
              content: "Write one natural X post for Kendra Bexly. Voice sample to emulate in rhythm and perspective: first person, informal, confident, sensual, conversational, and direct to the gentleman. Write like I actually talk, not like poetry, romance fiction, luxury ad copy, or a scripted seduction. Use everyday words, contractions, short natural sentences, and casual phrasing. Avoid flowery metaphors, dramatic imagery, phrases like the air is charged, palpable connection, whispered secrets, intoxicating, magnetic pull, or other poetic language. Make attraction and desire sound candid, playful, and real. A representative pattern is: the atmosphere feels charged, I notice his gaze, I can feel the tension between us, and I know we are both exactly where we want to be. Do not copy the sample wording verbatim. Keep the voice natural, polished, and personal. Write all user facing topic ideas and finished posts from my first person point of view, using I, me, and my naturally. Never refer to me as Kendra, Kendra Bexly, she, her, or a third person brand character inside generated copy. The name Kendra Bexly may appear only in internal instructions, never in the returned writing. Brand direction: subtly attract men who enjoy being attentive, generous, chivalrous, and making a woman feel cared for, admired, catered to, and spoiled. Express this through feminine luxury, standards, reciprocity, anticipation, thoughtful gestures, being well looked after, chemistry, and appreciation — never blunt demands or transactional language. Kendra does NOT offer cooking dates; never suggest cooking together, cooking for a client, kitchen dates, chef-at-home dates, or food-preparation activities. Requested writing styles: "+selectedStyles.join(", ")+". Blend all selected styles naturally. "+(format==="reflective-soft-scenario"?"Optional post format is active: structure the post like a compact lifestyle reflection, open with an engaging question or observation, paint one or two small desirable scenarios, then land on a subtle Kendra brand preference or standard. The sample pattern is the FEEL, not wording to copy. Keep it natural and within 280 characters. ":"")+"Warm flirty tease means warm and personal with playful anticipation, chemistry, and a subtle tease; conversational means relaxed and human; playful means witty and charming; direct means clear and confident; fun means lively, upbeat, and spontaneous; funny means naturally humorous without forcing jokes; sarcastic means clever, dry, and playfully sharp without being mean; sexual means mature, sensual, suggestive, and chemistry driven without graphic sexual detail. Sexual tone "+sexualTone+" means either subtle innuendo for suggestive, or stronger and more passionate wording for non graphic passionate, while still avoiding graphic descriptions of sexual acts. Optimize for genuine engagement through relatable observations, easy opinions, curiosity, or natural reply opportunities without engagement bait. Sound personable, confident, conversational, and human. Do not use hyphens, em dashes, or en dashes in the finished post. Use commas, periods, colons, or natural sentence breaks instead. Avoid corporate language, clickbait, hashtags unless clearly useful, and excessive emojis. Never claim facts not supplied by the user. Return only the finished post, with no labels, quotation marks, explanations, or alternatives. Write a complete, natural thought in 280 characters or fewer. The topic or idea supplied by the user may be longer than 280 characters; summarize it into one finished post within the 280-character limit."
            },
            { role: "user", content: idea }
          ],
          max_tokens: 500,
          temperature: 0.8
        });
        let content = String(aiResult?.response || aiResult?.result?.response || "").trim();
        content = content.replace(/^["“]|["”]$/g, "").trim();
        if (!content) throw new Error("Workers AI returned an empty response.");
        if (content.length > 280) content = content.slice(0, 277).trimEnd() + "...";

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

    if (url.pathname === "/api/admin/x/library") {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_content_library (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,content TEXT NOT NULL,content_style TEXT,image_base64 TEXT,mime_type TEXT,file_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
      if(request.method==="GET"){try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN last_used_at TEXT").run();}catch(e){}try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN archived_at TEXT").run();}catch(e){}const q=await env.DB.prepare("SELECT id,title,content,content_style,CASE WHEN image_base64 IS NULL THEN 0 ELSE 1 END AS has_image,mime_type,file_name,created_at,updated_at,last_used_at,archived_at FROM x_content_library ORDER BY id DESC LIMIT 100").all();return Response.json({ok:true,items:q.results||[]});}
      if(request.method==="POST"){const d=await request.json(),content=String(d.content||"").trim(),title=String(d.title||"").trim().slice(0,120),style=String(d.content_style||"").trim().slice(0,80),base64=String(d.image_base64||"").replace(/^data:[^;]+;base64,/,""),mime=String(d.mime_type||""),name=String(d.file_name||"").slice(0,150);if(!content)return Response.json({ok:false,message:"Add content before saving."},{status:400});if(base64&&(!["image/jpeg","image/png","image/webp"].includes(mime)||base64.length>5500000))return Response.json({ok:false,message:"Use a JPG, PNG, or WebP image under about 4 MB."},{status:400});const q=await env.DB.prepare("INSERT INTO x_content_library(title,content,content_style,image_base64,mime_type,file_name) VALUES(?,?,?,?,?,?)").bind(title||null,content,style||null,base64||null,base64?mime:null,base64?name:null).run();return Response.json({ok:true,id:q.meta.last_row_id});}
    }
    if (/^\/api\/admin\/x\/library\/\d+$/.test(url.pathname)) {const id=Number(url.pathname.split("/").pop());await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_content_library (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,content TEXT NOT NULL,content_style TEXT,image_base64 TEXT,mime_type TEXT,file_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();if(request.method==="DELETE"){await env.DB.prepare("DELETE FROM x_content_library WHERE id=?").bind(id).run();return Response.json({ok:true});}if(request.method==="POST"){const d=await request.json().catch(()=>({}));if(d.action==="mark_used"){try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN last_used_at TEXT").run();}catch(e){}await env.DB.prepare("UPDATE x_content_library SET last_used_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();return Response.json({ok:true});}if(d.action==="archive"||d.action==="restore"){try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN archived_at TEXT").run();}catch(e){}await env.DB.prepare("UPDATE x_content_library SET archived_at="+(d.action==="archive"?"CURRENT_TIMESTAMP":"NULL")+",updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();return Response.json({ok:true,archived:d.action==="archive"});}return Response.json({ok:false,message:"Unknown library action."},{status:400});}if(request.method==="GET"){const x=await env.DB.prepare("SELECT * FROM x_content_library WHERE id=?").bind(id).first();if(!x)return Response.json({ok:false,message:"Library item not found."},{status:404});return Response.json({ok:true,item:{...x,data_url:x.image_base64?"data:"+x.mime_type+";base64,"+x.image_base64:null}});}}

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
        SELECT d.id, d.content, d.status, d.x_post_id, d.created_at, d.updated_at, d.published_at, CASE WHEN m.draft_id IS NULL THEN 0 ELSE 1 END AS has_media, CASE WHEN s.draft_id IS NULL THEN 0 ELSE 1 END AS is_scheduled
        FROM x_post_drafts d LEFT JOIN x_draft_media m ON m.draft_id=d.id LEFT JOIN x_scheduled_posts s ON s.draft_id=d.id AND s.status='scheduled' ORDER BY d.id DESC LIMIT 50
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
      if (content.length > 280) return Response.json({ ok: false, message: "Posts must be 280 characters or fewer." }, { status: 400 });
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

    if (/^\/api\/admin\/x\/drafts\/\d+\/media$/.test(url.pathname)) {
      const id=Number(url.pathname.split("/")[5]);await ensureXDraftMedia(env);const draft=await env.DB.prepare("SELECT id,status FROM x_post_drafts WHERE id=?").bind(id).first();if(!draft)return Response.json({ok:false,message:"Draft not found."},{status:404});
      if(request.method==="GET"){const m=await env.DB.prepare("SELECT mime_type,file_name,image_base64 FROM x_draft_media WHERE draft_id=?").bind(id).first();return Response.json({ok:true,media:m?{mime_type:m.mime_type,file_name:m.file_name,data_url:"data:"+m.mime_type+";base64,"+m.image_base64}:null});}
      if(request.method==="DELETE"){await env.DB.prepare("DELETE FROM x_draft_media WHERE draft_id=?").bind(id).run();return Response.json({ok:true});}
      if(request.method==="POST"){if(draft.status==="published")return Response.json({ok:false,message:"Published posts cannot be changed."},{status:400});const d=await request.json(),mime=String(d.mime_type||""),name=String(d.file_name||"image").slice(0,150),base64=String(d.image_base64||"").replace(/^data:[^;]+;base64,/,"");if(!["image/jpeg","image/png","image/webp"].includes(mime))return Response.json({ok:false,message:"Use a JPG, PNG, or WebP image."},{status:400});if(!base64||base64.length>5500000)return Response.json({ok:false,message:"Image is too large. Please use an image under about 4 MB."},{status:400});await env.DB.prepare("INSERT INTO x_draft_media(draft_id,mime_type,file_name,image_base64,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(draft_id) DO UPDATE SET mime_type=excluded.mime_type,file_name=excluded.file_name,image_base64=excluded.image_base64,updated_at=CURRENT_TIMESTAMP").bind(id,mime,name,base64).run();return Response.json({ok:true});}
    }

    if (url.pathname.startsWith("/api/admin/x/drafts/") && request.method === "PUT") {
      const id = Number(url.pathname.split("/").pop());
      const data = await request.json();
      const content = String(data.content || "").trim();
      if (!Number.isInteger(id) || id < 1) return Response.json({ ok: false, message: "Invalid draft ID." }, { status: 400 });
      if (!content) return Response.json({ ok: false, message: "Draft cannot be empty." }, { status: 400 });
      if (content.length > 280) return Response.json({ ok: false, message: "Posts must be 280 characters or fewer." }, { status: 400 });
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

    async function ensureXWeeklyPlanTable() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS x_weekly_plan_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          week_start TEXT NOT NULL,
          planned_for TEXT NOT NULL,
          slot_index INTEGER NOT NULL,
          content_style TEXT,
          draft_id INTEGER NOT NULL UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(week_start, planned_for, slot_index)
        )
      `).run();
    }

    if (url.pathname === "/api/admin/x/weekly-plan" && request.method === "GET") {
      await ensureXWeeklyPlanTable(); await ensureXScheduledTable(); await ensureXDraftMedia(env);
      const weekStart=String(url.searchParams.get("week_start")||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return Response.json({ok:false,message:"Choose a valid week starting date."},{status:400});
      const rows=await env.DB.prepare(`
        SELECT p.id,p.week_start,p.planned_for,p.slot_index,p.content_style,p.draft_id,
          d.content,d.status,d.x_post_id,d.published_at,
          CASE WHEN m.draft_id IS NULL THEN 0 ELSE 1 END AS has_media,
          s.id AS schedule_id,s.scheduled_for,s.status AS schedule_status
        FROM x_weekly_plan_items p
        JOIN x_post_drafts d ON d.id=p.draft_id
        LEFT JOIN x_draft_media m ON m.draft_id=d.id
        LEFT JOIN x_scheduled_posts s ON s.draft_id=d.id AND s.status='scheduled'
        WHERE p.week_start=? ORDER BY p.planned_for,p.slot_index
      `).bind(weekStart).all();
      return Response.json({ok:true,items:rows.results||[]});
    }

    if (url.pathname === "/api/admin/x/weekly-plan" && request.method === "POST") {
      await ensureXWeeklyPlanTable();
      const data=await request.json(),draftId=Number(data.draft_id),weekStart=String(data.week_start||"").trim(),plannedFor=String(data.planned_for||"").trim(),slotIndex=Number(data.slot_index),style=String(data.content_style||"").trim();
      if(!Number.isInteger(draftId)||draftId<1||!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)||!/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)||!Number.isInteger(slotIndex)||slotIndex<0||slotIndex>9) return Response.json({ok:false,message:"Invalid weekly plan item."},{status:400});
      const draft=await env.DB.prepare("SELECT id FROM x_post_drafts WHERE id=?").bind(draftId).first();if(!draft)return Response.json({ok:false,message:"Draft not found."},{status:404});
      const occupied=await env.DB.prepare("SELECT draft_id FROM x_weekly_plan_items WHERE week_start=? AND planned_for=? AND slot_index=? AND draft_id<>?").bind(weekStart,plannedFor,slotIndex,draftId).first();
      if(occupied)return Response.json({ok:false,message:"That weekly slot already has a post."},{status:409});
      await env.DB.prepare(`INSERT INTO x_weekly_plan_items(week_start,planned_for,slot_index,content_style,draft_id,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(draft_id) DO UPDATE SET week_start=excluded.week_start,planned_for=excluded.planned_for,slot_index=excluded.slot_index,content_style=excluded.content_style,updated_at=CURRENT_TIMESTAMP`).bind(weekStart,plannedFor,slotIndex,style,draftId).run();
      return Response.json({ok:true});
    }

    if (url.pathname === "/api/admin/x/weekly-plan/remove" && request.method === "POST") {
      await ensureXWeeklyPlanTable();
      const data=await request.json().catch(()=>({})),draftId=Number(data.draft_id);
      if(!Number.isInteger(draftId)||draftId<1) return Response.json({ok:false,message:"Choose a valid planned post."},{status:400});
      const scheduled=await env.DB.prepare("SELECT id FROM x_scheduled_posts WHERE draft_id=? AND status='scheduled'").bind(draftId).first().catch(()=>null);
      if(scheduled) return Response.json({ok:false,message:"Cancel this post's schedule before removing it from the weekly plan."},{status:400});
      await env.DB.prepare("DELETE FROM x_weekly_plan_items WHERE draft_id=?").bind(draftId).run();
      return Response.json({ok:true});
    }

    if (url.pathname === "/api/admin/x/weekly-plan/move" && request.method === "POST") {
      await ensureXWeeklyPlanTable();
      const data=await request.json().catch(()=>({})),draftId=Number(data.draft_id),weekStart=String(data.week_start||"").trim(),plannedFor=String(data.planned_for||"").trim(),slotIndex=Number(data.slot_index);
      if(!Number.isInteger(draftId)||draftId<1||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(weekStart)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(plannedFor)||!Number.isInteger(slotIndex)||slotIndex<0||slotIndex>9) return Response.json({ok:false,message:"Choose a valid weekly-plan destination."},{status:400});
      const scheduled=await env.DB.prepare("SELECT id FROM x_scheduled_posts WHERE draft_id=? AND status='scheduled'").bind(draftId).first().catch(()=>null);
      if(scheduled) return Response.json({ok:false,message:"Cancel this post's schedule before moving it."},{status:400});
      const occupied=await env.DB.prepare("SELECT draft_id FROM x_weekly_plan_items WHERE week_start=? AND planned_for=? AND slot_index=? AND draft_id<>?").bind(weekStart,plannedFor,slotIndex,draftId).first();
      if(occupied) return Response.json({ok:false,message:"That weekly slot already has a post."},{status:409});
      await env.DB.prepare("UPDATE x_weekly_plan_items SET week_start=?,planned_for=?,slot_index=?,updated_at=CURRENT_TIMESTAMP WHERE draft_id=?").bind(weekStart,plannedFor,slotIndex,draftId).run();
      return Response.json({ok:true});
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
        body: JSON.stringify(await (async()=>{const mediaId=await uploadXImage(env,id,accessToken);return mediaId?{text:draft.content,media:{media_ids:[mediaId]}}:{text:draft.content};})())
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
          ${draft.special_offer ? `<div style="margin-top:28px;padding:20px;background:#eee7dc;"><strong>This Month's Special</strong><p style="line-height:1.65;">${para(draft.special_offer)}</p><a href="https://kendrabexly.com/request?newsletter_offer=${encodeURIComponent(String(draft.id))}&subscriber_special=choose" style="display:inline-block;margin-top:8px;padding:12px 18px;background:#29282d;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">Book My Subscriber Special</a><p style="margin:12px 0 0;font:12px Arial,sans-serif;color:#77736f;">Book through this button so your subscriber special is attached to your request.</p></div>` : ""}
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

  // Public lookup for a newsletter offer attached to a booking link
  if (
    url.pathname === "/api/newsletter/offer" &&
    request.method === "GET"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ ok: false, message: "Invalid newsletter offer." }, { status: 400 });
    }

    const offer = await env.DB.prepare(
      "SELECT id, special_offer, created_at FROM newsletter_drafts WHERE id = ? LIMIT 1"
    ).bind(id).first();

    if (!offer) {
      return Response.json({ ok: false, message: "Newsletter offer not found." }, { status: 404 });
    }

    const created = new Date(offer.created_at);
    const now = new Date();
    const expired =
      created.getUTCFullYear() !== now.getUTCFullYear() ||
      created.getUTCMonth() !== now.getUTCMonth();

    const monthly_specials = [
      { id:"classic-rendezvous", experience:"Classic Rendezvous", duration:"1.5 hours", price:500, label:"Classic Rendezvous — 1.5 hours at $500" },
      { id:"greek-princess", experience:"The Greek Princess", duration:"1.5 hours", price:650, label:"The Greek Princess — 1.5 hours at $650" }
    ];

    return Response.json({
      ok: true,
      id: offer.id,
      special_offer: offer.special_offer || "",
      monthly_specials,
      expired
    });
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

    const monthlySubscriberOffers = [
      { experience: "Signature Private Companionship Experience", duration: "1 hour", regular: 500, incentive: "30 extra minutes" },
      { experience: "Signature Private Companionship Experience", duration: "2 hours", regular: 750, incentive: "30 extra minutes" },
      { experience: "Signature Private Companionship Experience", duration: "3 hours", regular: 1000, incentive: "30 extra minutes" },
      { experience: "Signature Private Companionship Experience", duration: "4 hours", regular: 1250, incentive: "30 extra minutes" },
      { experience: "The Greek Princess", duration: "1 hour", regular: 650, incentive: "30 extra minutes" },
      { experience: "The Greek Princess", duration: "1.5 hours", regular: 800, incentive: "30 extra minutes" },
      { experience: "The Greek Princess", duration: "2 hours", regular: 1050, incentive: "30 extra minutes" }
    ];
    // The experiences stay fixed; the monthly incentive rotates.
    // Each month selects a base duration from 1–4 hours and adds 30 bonus minutes,
    // creating specials from 1.5 through 4.5 hours without discounting the base rate.
    const classicRates = [
      { base:"1 hour", special:"1.5 hours", price:500 },
      { base:"2 hours", special:"2.5 hours", price:750 },
      { base:"3 hours", special:"3.5 hours", price:1000 },
      { base:"4 hours", special:"4.5 hours", price:1250 }
    ];
    const greekRates = [
      { base:"1 hour", special:"1.5 hours", price:650 },
      { base:"1.5 hours", special:"2 hours", price:800 },
      { base:"2 hours", special:"2.5 hours", price:1050 },
      { base:"3 hours", special:"3.5 hours", price:1300 },
      { base:"4 hours", special:"4.5 hours", price:1550 }
    ];
    const monthIndex = now.getFullYear() * 12 + now.getMonth();
    const classicMonthlySpecial = classicRates[monthIndex % classicRates.length];
    const greekMonthlySpecial = greekRates[monthIndex % greekRates.length];
    const offerIndex = monthIndex % monthlySubscriberOffers.length;
    const monthlyOffer = monthlySubscriberOffers[offerIndex];
    const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

    const flirtyOfferIntros = [
      "I saved a little something for you this month… because I think we deserve a little more time together. 😉",
      "I saved a little temptation for your inbox this month. ✨",
      "Consider this your invitation to disappear with me for a little while. 💋",
      "I have a feeling a little extra time together would look good on us. 😉",
      "Your inbox deserves something more exciting than the usual… so I saved this one for you. ✨",
      "Maybe this is the sign you needed to finally make some time for me. 💋",
      "I’m giving you a very good reason to put something fun on the calendar. 😉"
    ];
    const flirtyOfferClosers = [
      "Consider it my excuse to steal you away for a while.",
      "Come make a little time for me — I promise the calendar can wait.",
      "I’ll save the flirting for when we’re together. 😉",
      "The only thing missing from this offer is you.",
      "I think we can make those hours feel very well spent.",
      "A little anticipation never hurt anybody. 💋",
      "You bring yourself. I’ll take care of making the time feel special."
    ];
    const flirtyIndex = offerIndex % flirtyOfferIntros.length;

    const specialOffer =
      String(
        data.special_offer ||
        `${flirtyOfferIntros[flirtyIndex]}\n\nThis month's featured experiences:\n\nClassic Rendezvous — book ${classicMonthlySpecial.base} at ${money(classicMonthlySpecial.price)} and enjoy ${classicMonthlySpecial.special}.\n\nThe Greek Princess — book ${greekMonthlySpecial.base} at ${money(greekMonthlySpecial.price)} and enjoy ${greekMonthlySpecial.special}.\n\nThe experiences stay the same; the little extra changes each month. Choose the one that catches your eye when you're ready to make plans with me.\n\n${flirtyOfferClosers[flirtyIndex]} This little invitation is only around for ${month} and, of course, depends on my availability. 💋`
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

  // Choose the monthly offer independently for both fixed experiences.
  if (
    /^\/api\/admin\/newsletter\/drafts\/\d+\/change-offer-experience$/.test(url.pathname) &&
    request.method === "POST"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.pathname.split("/")[5]);
    const existing = await env.DB.prepare("SELECT * FROM newsletter_drafts WHERE id = ?").bind(id).first();
    if (!existing) return Response.json({ok:false,message:"Newsletter draft not found."},{status:404});
    if (existing.status !== "draft") return Response.json({ok:false,message:"Only draft newsletter offers can be changed."},{status:400});

    const current = String(existing.special_offer || "").trim();
    if (!current) return Response.json({ok:false,message:"Generate the monthly offer before choosing its specials."},{status:400});
    const data = await request.json().catch(() => ({}));

    // Margin-protected choices: price-only discounts stay under 10%; combination
    // offers use about 5% off because they also include extra time.
    const classicOptions = [
      {id:"classic-time-1",base:"1 hour",special:"1.5 hours",price:500,type:"Extra Time",label:"Extra Time · $500 for 1 hour · enjoy 1.5 hours"},
      {id:"classic-time-2",base:"2 hours",special:"2.5 hours",price:750,type:"Extra Time",label:"Extra Time · $750 for 2 hours · enjoy 2.5 hours"},
      {id:"classic-time-3",base:"3 hours",special:"3.5 hours",price:1000,type:"Extra Time",label:"Extra Time · $1,000 for 3 hours · enjoy 3.5 hours"},
      {id:"classic-time-4",base:"4 hours",special:"4.5 hours",price:1250,type:"Extra Time",label:"Extra Time · $1,250 for 4 hours · enjoy 4.5 hours"},
      {id:"classic-price-2",base:"2 hours",special:"2 hours",price:700,regular:750,type:"Special Price",label:"Special Price · 2 hours $700 · normally $750 · save $50"},
      {id:"classic-price-3",base:"3 hours",special:"3 hours",price:925,regular:1000,type:"Special Price",label:"Special Price · 3 hours $925 · normally $1,000 · save $75"},
      {id:"classic-price-4",base:"4 hours",special:"4 hours",price:1125,regular:1250,type:"Special Price",label:"Special Price · 4 hours $1,125 · normally $1,250 · save $125"},
      {id:"classic-combo-3",base:"3 hours",special:"3.5 hours",price:950,regular:1000,type:"Price + Extra Time",label:"Combo · $950 + 30 extra minutes · normally $1,000"}
    ];
    const greekOptions = [
      {id:"greek-time-1",base:"1 hour",special:"1.5 hours",price:650,type:"Extra Time",label:"Extra Time · $650 for 1 hour · enjoy 1.5 hours"},
      {id:"greek-time-15",base:"1.5 hours",special:"2 hours",price:800,type:"Extra Time",label:"Extra Time · $800 for 1.5 hours · enjoy 2 hours"},
      {id:"greek-time-2",base:"2 hours",special:"2.5 hours",price:1050,type:"Extra Time",label:"Extra Time · $1,050 for 2 hours · enjoy 2.5 hours"},
      {id:"greek-time-3",base:"3 hours",special:"3.5 hours",price:1300,type:"Extra Time",label:"Extra Time · $1,300 for 3 hours · enjoy 3.5 hours"},
      {id:"greek-time-4",base:"4 hours",special:"4.5 hours",price:1550,type:"Extra Time",label:"Extra Time · $1,550 for 4 hours · enjoy 4.5 hours"},
      {id:"greek-price-15",base:"1.5 hours",special:"1.5 hours",price:750,regular:800,type:"Special Price",label:"Special Price · 1.5 hours $750 · normally $800 · save $50"},
      {id:"greek-price-2",base:"2 hours",special:"2 hours",price:975,regular:1050,type:"Special Price",label:"Special Price · 2 hours $975 · normally $1,050 · save $75"},
      {id:"greek-price-3",base:"3 hours",special:"3 hours",price:1200,regular:1300,type:"Special Price",label:"Special Price · 3 hours $1,200 · normally $1,300 · save $100"},
      {id:"greek-price-4",base:"4 hours",special:"4 hours",price:1400,regular:1550,type:"Special Price",label:"Special Price · 4 hours $1,400 · normally $1,550 · save $150"},
      {id:"greek-combo-3",base:"3 hours",special:"3.5 hours",price:1235,regular:1300,type:"Price + Extra Time",label:"Combo · $1,235 + 30 extra minutes · normally $1,300"}
    ];

    // With no selections, return the choices so the dashboard can render a picker.
    if (!data.classic_offer || !data.greek_offer) {
      return Response.json({ok:true,choose_offer:true,classic_options:classicOptions,greek_options:greekOptions});
    }
    const classic = classicOptions.find(x => x.id === String(data.classic_offer));
    const greek = greekOptions.find(x => x.id === String(data.greek_offer));
    if (!classic || !greek) return Response.json({ok:false,message:"Choose one valid offer for each experience."},{status:400});

    const dollars = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
    const offerCopy = (name,x) => x.type === "Special Price"
      ? `${name} — ${x.special} at ${dollars(x.price)} this month (normally ${dollars(x.regular)}).`
      : x.type === "Price + Extra Time"
        ? `${name} — book ${x.base} at ${dollars(x.price)} and enjoy ${x.special} with me.`
        : `${name} — book ${x.base} at ${dollars(x.price)} and enjoy ${x.special}.`;
    const specialsBlock = `This month's featured experiences:\n\n${offerCopy("Classic Rendezvous",classic)}\n\n${offerCopy("The Greek Princess",greek)}\n\nChoose the experience that catches your eye when you're ready to make plans with me.`;

    let specialOffer = current;
    const start = specialOffer.search(/This month's featured experience(?:s)?:/i);
    if (start >= 0) {
      const tail = specialOffer.slice(start);
      const endMatch = tail.match(/\n\n(?=(?:Consider it|Come make|I’ll save|I'll save|The only thing|I think we can|A little anticipation|You bring yourself))/i);
      const end = endMatch ? start + endMatch.index : specialOffer.length;
      specialOffer = specialOffer.slice(0,start) + specialsBlock + specialOffer.slice(end);
    } else {
      specialOffer = specialsBlock + "\n\n" + specialOffer;
    }
    await env.DB.prepare("UPDATE newsletter_drafts SET special_offer=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(specialOffer,id).run();
    return Response.json({ok:true,special_offer:specialOffer,classic_offer:classic,greek_offer:greek});
  }

  // Regenerate special-offer wording and upgrade older single-experience drafts to both monthly specials.
  if (
    /^\/api\/admin\/newsletter\/drafts\/\d+\/regenerate-offer$/.test(url.pathname) &&
    request.method === "POST"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.pathname.split("/")[5]);
    const existing = await env.DB.prepare("SELECT * FROM newsletter_drafts WHERE id = ?").bind(id).first();
    if (!existing) return Response.json({ok:false,message:"Newsletter draft not found."},{status:404});
    if (existing.status !== "draft") return Response.json({ok:false,message:"Only draft newsletter offers can be regenerated."},{status:400});

    const data = await request.json().catch(() => ({}));
    const offer = String(data.special_offer || existing.special_offer || "").trim();
    const offerNow = new Date();
    const month = offerNow.toLocaleString("en-US",{month:"long",timeZone:"America/Los_Angeles"});
    const offerMonthIndex = offerNow.getFullYear() * 12 + offerNow.getMonth();
    const classicOptions = [
      {base:"1 hour",special:"1.5 hours",price:500},
      {base:"2 hours",special:"2.5 hours",price:750},
      {base:"3 hours",special:"3.5 hours",price:1000},
      {base:"4 hours",special:"4.5 hours",price:1250}
    ];
    const greekOptions = [
      {base:"1 hour",special:"1.5 hours",price:650},
      {base:"1.5 hours",special:"2 hours",price:800},
      {base:"2 hours",special:"2.5 hours",price:1050},
      {base:"3 hours",special:"3.5 hours",price:1300},
      {base:"4 hours",special:"4.5 hours",price:1550}
    ];
    const classicSpecial = classicOptions[offerMonthIndex % classicOptions.length];
    const greekSpecial = greekOptions[offerMonthIndex % greekOptions.length];
    const intros = [
      "I saved a little something especially for you this month. ✨",
      "I thought you might enjoy a little something special from me this month. 💋",
      "I wanted to give you a good reason to put something special on your calendar this month. 😉",
      "A new month feels like the perfect excuse for us to make a little more time for each other. ✨",
      "Consider this a little invitation from me to you to make some time for us this month. 💋"
    ];
    const closers = [
      "Consider it my excuse to steal you away for a while.",
      "I think we can make that time feel very well spent.",
      "The only thing missing from this offer is you.",
      "A little anticipation makes the plans even better.",
      "You bring yourself; I'll take care of making the time feel special."
    ];
    const currentIntroIndex = intros.findIndex(x => offer.startsWith(x));
    const seed = currentIntroIndex >= 0 ? (currentIntroIndex + 1) % intros.length : id % intros.length;
    const specialOffer = `${intros[seed]}\n\nThis month's featured experiences:\n\nClassic Rendezvous — book ${classicSpecial.base} at ${classicSpecial.price} and enjoy ${classicSpecial.special}.\n\nThe Greek Princess — book ${greekSpecial.base} at ${greekSpecial.price} and enjoy ${greekSpecial.special}.\n\nThe experiences stay the same; the little extra changes each month. Choose the one that catches your eye when you're ready to make plans with me.\n\n${closers[seed]} This little invitation is only around for ${month} and, of course, depends on my availability. 💋`;

    await env.DB.prepare("UPDATE newsletter_drafts SET special_offer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(specialOffer,id).run();
    return Response.json({ok:true,special_offer:specialOffer});
  }

  // Regenerate newsletter wording while preserving required offer instructions
  if (
    /^\/api\/admin\/newsletter\/drafts\/\d+\/regenerate$/.test(url.pathname) &&
    request.method === "POST"
  ) {
    await ensureNewsletterTable();
    const id = Number(url.pathname.split("/")[5]);
    const existing = await env.DB.prepare(
      "SELECT * FROM newsletter_drafts WHERE id = ?"
    ).bind(id).first();
    if (!existing) return Response.json({ok:false,message:"Newsletter draft not found."},{status:404});
    if (existing.status !== "draft") return Response.json({ok:false,message:"Only draft newsletters can be regenerated."},{status:400});

    const data = await request.json().catch(() => ({}));
    const now = new Date();
    const month = now.toLocaleString("en-US",{month:"long",timeZone:"America/Los_Angeles"});
    const year = now.toLocaleString("en-US",{year:"numeric",timeZone:"America/Los_Angeles"});
    const seed = (Date.now() + id) % 4;
    const subjects = [
      `${month} with Kendra — A Note Just for You`,
      `A Little ${month} Update from Kendra`,
      `Kendra's ${month} Note — Something Special Inside`,
      `${month} Notes, a New Journal Entry & Something for You`
    ];
    // Newsletter voice: intimate, confident and lightly seductive without becoming
    // explicit or sounding like an ad. Build anticipation first, then make the invitation
    // feel personal and easy to act on.
    const intros = [
      `Hi there,\n\nI hope ${month} is treating you well. I have been thinking about how good it feels to have something — or someone — worth looking forward to. A little anticipation, the right company, and enough time to forget about everything outside the room can be a very tempting combination.\n\nI have a new journal entry for you below, and I saved a little invitation for us too. If it catches your attention, maybe we should stop imagining the time together and put it on the calendar.\n\nTalk soon,\nKendra 💋`,
      `Hi there,\n\nI have been meaning to check in. There is something about ${month} that makes me want to slow things down a little — better conversation, lingering moments, and plans neither of us needs to rush through. You know, the kind of time that stays on your mind afterward.\n\nI wrote something new for you below, and I also left you a little temptation for this month. If you have been thinking about seeing me, consider this your invitation to finally make the plan.\n\nHope to see you soon,\nKendra`,
      `Hi there,\n\nHow have you been? I wanted this to feel less like a newsletter and more like a quiet note from me landing in your inbox at just the right time. I have been thinking about chemistry, anticipation, and how much better an evening feels when you have been looking forward to it all week.\n\nThere is a fresh journal entry below, followed by a little ${month} invitation from me. Take a peek. If it makes you smile — or makes your mind wander a little — I think we should give ourselves something to look forward to.\n\nKendra 💋`,
      `Hi there,\n\nJust a little note from me to you. I hope life has been treating you well, but if your calendar could use something a little more interesting, I may have an idea. I am leaving room this month for unhurried plans, good energy, and the kind of company that makes a few hours disappear much too quickly.\n\nI have something new from my journal to share and a special invitation waiting below. No hard sell. Just me giving you a very good excuse to come see me.\n\nSee you soon,\nKendra 💋`
    ];
    const blogTitles = [
      `${month} ${year}: A Little Anticipation Looks Good on You`,
      `${month} ${year}: Maybe We Should Take Our Time`,
      `${month} ${year}: Give Yourself Something to Look Forward To`,
      `${month} ${year}: Consider This Your Little Escape`
    ];
    const blogs = [
      `I think anticipation is underrated. There is something delicious about knowing you have plans coming up — the kind that make you catch yourself smiling when they cross your mind.\n\nFor me, the best time together never feels overly planned or rushed. It is the conversation that gets easier, the little glances, the laughter, and that moment when you realize you have completely stopped paying attention to the clock. That is the kind of energy I want more of in ${month}.\n\nAnd since I am already putting the idea in your head, I left a little invitation for you below. Maybe it is exactly the excuse we needed to put something worth anticipating on the calendar. 💋`,
      `There is something very attractive about taking your time. No racing through the evening, no watching the clock — just settling in, enjoying the company, and letting the mood find its own rhythm.\n\nThose are usually the moments I remember most: an unexpectedly good conversation, a look that lasts a second longer than it should, or realizing a few hours somehow disappeared. A little chemistry has a way of doing that.\n\nSo for ${month}, I am making room for more of it. I saved something special just below this note, and if you have been thinking about seeing me, I have a feeling you are going to like your excuse. 😉`,
      `Sometimes the best part of a plan happens before it even begins. It is knowing the date is on the calendar, wondering how the evening will unfold, and letting your imagination do just enough work in the meantime.\n\nI love plans that feel easy but still give you that little spark of anticipation. Good company. Enough time to relax into the moment. A reason to put the rest of the world on quiet for a while.\n\nIf that sounds tempting, keep going. I tucked a ${month} invitation below that might make your calendar considerably more interesting. 💋`,
      `Everyone deserves a little escape now and then — not necessarily somewhere far away, just somewhere the rest of the day cannot follow you. A few unhurried hours, good conversation, a little chemistry, and nowhere else either of us needs to be.\n\nThat is what has been on my mind lately: making plans that feel like a genuine break from the ordinary. Something warm, playful, and just tempting enough to look forward to all week.\n\nWhich brings me to the little invitation waiting below. Take a look at what I saved for ${month}. If one catches your eye, I would love to be the reason you clear a little space on your calendar. 😉`
    ];

    // Full newsletter regeneration never rewrites the special offer.
    // Preserve the saved offer exactly so its experience, duration, price and client-facing wording stay locked.
    const specialOffer = String(existing.special_offer || "").trim();
    if (!specialOffer) {
      return Response.json({ok:false,message:"Create the monthly special offer before regenerating the newsletter."},{status:400});
    }

    const draft = {
      subject: subjects[seed],
      content: intros[seed],
      blog_title: blogTitles[seed],
      blog_content: blogs[seed],
      special_offer: specialOffer
    };

    await env.DB.prepare(`
      UPDATE newsletter_drafts
      SET subject=?, content=?, blog_title=?, blog_content=?, special_offer=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(draft.subject,draft.content,draft.blog_title,draft.blog_content,draft.special_offer,id).run();

    return Response.json({ok:true,draft});
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

        const requestedStart =
          new Date(requestedDate + "T" + requestedTime);

        if (
          !Number.isFinite(requestedStart.getTime()) ||
          requestedStart.getTime() < Date.now() + 60 * 60 * 1000
        ) {
          return Response.json(
            {
              ok: false,
              message: "Please choose a start time at least 1 hour from the time you submit your request."
            },
            { status: 400 }
          );
        }

        const screeningAcknowledgement =
          data.screening_acknowledgement === "yes";

        const depositAcknowledgement =
          data.deposit_acknowledgement === "yes";

        const newsletterOfferId =
          String(data.newsletter_offer || "").trim();

        const subscriberSpecial =
          String(data.subscriber_special || "").trim();
        const monthlySpecials = {
          "classic-rendezvous": { experience:"Classic Rendezvous", duration:"1.5 hours", price:500 },
          "greek-princess": { experience:"The Greek Princess", duration:"1.5 hours", price:650 }
        };
        const selectedSubscriberSpecial = monthlySpecials[subscriberSpecial] || null;

        let newsletterOffer = null;
        let newsletterOfferExpired = false;
        if (/^\d+$/.test(newsletterOfferId)) {
          await ensureNewsletterTable();
          newsletterOffer = await env.DB.prepare(
            "SELECT id, special_offer, status, created_at FROM newsletter_drafts WHERE id = ? LIMIT 1"
          ).bind(Number(newsletterOfferId)).first();

          if (newsletterOffer?.created_at) {
            const created = new Date(newsletterOffer.created_at);
            const now = new Date();
            newsletterOfferExpired =
              created.getUTCFullYear() !== now.getUTCFullYear() ||
              created.getUTCMonth() !== now.getUTCMonth();
          }

          if (newsletterOfferExpired) {
            return Response.json(
              {
                ok: false,
                message: "That newsletter special has expired. Please use the current newsletter offer or submit a standard private request."
              },
              { status: 400 }
            );
          }
        }


        if (newsletterOffer && !selectedSubscriberSpecial) {
          return Response.json(
            { ok:false, message:"Please choose either the Classic Rendezvous or The Greek Princess monthly special." },
            { status:400 }
          );
        }

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


        // Check the blacklist using any identity information already connected
        // to a blocked profile. Prior blocked submissions remain linked to the
        // same client_id, so newly submitted email/phone aliases become matchable
        // on later attempts.

        const blacklisted = await env.DB.prepare(
          `SELECT b.id AS blacklist_id, b.client_id
           FROM blacklist b
           WHERE (b.email <> '' AND LOWER(b.email) = LOWER(?)) OR (b.phone <> '' AND b.phone = ?)
              OR EXISTS (
                SELECT 1 FROM clients c
                WHERE c.id = b.client_id
                  AND (LOWER(c.email) = LOWER(?) OR c.phone = ?)
              )
              OR EXISTS (
                SELECT 1 FROM date_requests dr
                WHERE dr.client_id = b.client_id
                  AND dr.status = 'blacklisted_submission'
                  AND (
                    LOWER(COALESCE(dr.notes,'')) LIKE ?
                    OR COALESCE(dr.notes,'') LIKE ?
                  )
              )
           ORDER BY b.id DESC
           LIMIT 1`
        ).bind(
          email, phone,
          email, phone,
          "%submitted email: " + email.toLowerCase() + "%",
          "%Submitted phone: " + phone + "%"
        ).first();

        if (blacklisted) {
          const flaggedClientId = blacklisted.client_id;
          const flagNotes = [
            "BLACKLISTED CLIENT SUBMISSION",
            "Linked blacklist record: #" + blacklisted.blacklist_id,
            "Submitted name: " + firstName + " " + lastName,
            "Submitted email: " + email,
            "Submitted phone: " + phone,
            "Requested date: " + requestedDate,
            "Requested time: " + requestedTime,
            dateType ? "Date type: " + dateType : null,
            appointmentType ? "Appointment type: " + appointmentType : null,
            duration ? "Duration: " + duration : null,
            locationName ? "Location: " + locationName : null,
            requestDetails ? "Request details: " + requestDetails : null
          ].filter(Boolean).join("\n");

          // Preserve the original blocked profile. The attempt is attached to
          // that profile rather than creating a second client record.
          await env.DB.prepare(
            `INSERT INTO date_requests
              (client_id, requested_date, requested_time, location_name, status, deposit_amount, deposit_paid, id_received, final_approval, notes)
             VALUES (?, ?, ?, ?, 'blacklisted_submission', 0, 0, 0, 0, ?)`
          ).bind(flaggedClientId, requestedDate, requestedTime, locationName, flagNotes).run();

          return Response.json(
            { ok:false, message:"This request cannot be accepted." },
            { status:403 }
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

          newsletterOffer
            ? `Newsletter special: Newsletter #${newsletterOffer.id}\nSelected monthly special: ${selectedSubscriberSpecial.experience} — ${selectedSubscriberSpecial.duration} at ${selectedSubscriberSpecial.price}\nOffer: ${newsletterOffer.special_offer || "Subscriber special"}`
            : newsletterOfferId
              ? `Newsletter special code received but not recognized: ${newsletterOfferId}`
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
                dr.created_at,
                (SELECT ed.sent_at FROM email_drafts ed WHERE ed.date_request_id=dr.id AND ed.email_type='after_date_follow_up' AND ed.status='sent' ORDER BY ed.sent_at DESC, ed.id DESC LIMIT 1) AS after_date_follow_up_sent_at
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


    if (url.pathname === "/api/admin/clients/profile" && request.method === "POST") {
      try {
        const data = await request.json();
        const clientId = Number(data.client_id);
        const allowedOfferStrategies = new Set(["extra-time","experience-upgrade","special-rate"]);
        const offerStrategy = allowedOfferStrategies.has(String(data.offer_strategy||"")) ? String(data.offer_strategy) : "extra-time";
        if (!Number.isFinite(clientId) || clientId <= 0) return Response.json({ok:false,message:"Client not found."},{status:400});
        const notes = String(data.notes || "").trim().slice(0,4000);
        const preferences = String(data.preferences || "").trim().slice(0,4000);
        try { await env.DB.prepare("ALTER TABLE clients ADD COLUMN preferences TEXT").run(); } catch (e) {}
        await env.DB.prepare("UPDATE clients SET notes=?, preferences=? WHERE id=?").bind(notes || null, preferences || null, clientId).run();
        return Response.json({ok:true,notes,preferences});
      } catch (error) {
        console.error("Admin client profile update error:", error);
        return Response.json({ok:false,message:"Unable to save client profile."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/follow-up" && request.method === "POST") {
      try {
        const data=await request.json();
        const clientId=Number(data.client_id);
        const followType="after-date";
        const tone=String(data.tone||"warm").slice(0,40);
        const length=String(data.length||"short").slice(0,20);
        const goal=String(data.goal||"no-pressure").slice(0,40);
        const instructions=String(data.instructions||"").trim().slice(0,700);
        if(!Number.isFinite(clientId)||clientId<=0)return Response.json({ok:false,message:"Choose a client first."},{status:400});
        const client=await env.DB.prepare("SELECT id,first_name,last_name,email,notes FROM clients WHERE id=? LIMIT 1").bind(clientId).first();
        if(!client)return Response.json({ok:false,message:"Client not found."},{status:404});
        try{await env.DB.prepare("ALTER TABLE clients ADD COLUMN preferences TEXT").run();}catch(e){}
        const profile=await env.DB.prepare("SELECT preferences FROM clients WHERE id=? LIMIT 1").bind(clientId).first();
        const lastCompleted=await env.DB.prepare("SELECT id FROM date_requests WHERE client_id=? AND status='completed' ORDER BY requested_date DESC, requested_time DESC, id DESC LIMIT 1").bind(clientId).first();
        if(!lastCompleted)return Response.json({ok:false,message:"This client does not have a successfully completed date yet."},{status:400});
        const prompt="Draft a short personal after date follow up for my most recent date marked successfully completed. The completed record is used only to establish eligibility and must not supply content for the message. Make it warm, appreciative, lightly flirty, and natural. Do not sound like customer service and do not pressure him to book again. Never mention when the date happened, including last night, last week, the other night, recently, or similar relative time references. Never mention how long we spent together. Never claim I had a great time, loved something, enjoyed a conversation, felt a certain way, found him easy to be around, or remember a specific moment unless that exact personal detail is explicitly present in Private notes, Private preferences, or Additional instructions. Generic appreciation such as thank you for spending time with me is allowed.";
        const controlPrompt="\nWriting controls: Tone: "+tone+". Length: "+length+". Goal: "+goal+". Additional instructions: "+(instructions||"none")+". Respect these controls while keeping the message natural.";
        const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
          {role:"system",content:"You write private client messages in my first person voice as an adult independent professional companion. My voice is informal, feminine, confident, warm, personal, and lightly sensual. Use everyday language and contractions. Never refer to me by name or in third person. Do not use poetic language, hyphens, em dashes, or en dashes. Do not invent memories, preferences, gifts, conversations, feelings, locations, or date details. Administrative booking history may establish that I have seen the client before, but it is not permission to mention the location or fabricate what happened there. Only mention a specific personal detail when it is explicitly written in Private notes or Private preferences. Keep it discreet and concise. Return ONLY the finished message itself. Never add labels, commentary, explanations, quotation marks, or phrases such as Here's a draft follow up message."},
          {role:"user",content:prompt+controlPrompt+"\nClient first name: "+String(client.first_name||"").trim()+"\nPrivate preferences: "+String(profile?.preferences||"").trim()+"\nPrivate notes: "+String(client.notes||"").trim()}
        ],max_tokens:350,temperature:0.72});
        let draft=String(ai?.response||ai?.result?.response||"").trim().replace(/^["“]|["”]$/g,"").replace(/[–—]/g,",");
        draft=draft.replace(/^\s*(?:here(?:'|’)s|here is)\s+(?:a|the|your)?\s*(?:draft\s+)?(?:follow\s*up\s+)?message\s*:?\s*/i,"").trim();
        draft=draft.replace(/^\s*(?:draft|message)\s*:?\s*/i,"").trim();
        if(!draft)throw new Error("Workers AI returned an empty message.");
        draft=draft.replace(/\n\s*Kendra\s*$/i,"").trim()+"\n\nKendra";
        return Response.json({ok:true,draft});
      } catch(error) {
        console.error("Client follow up generation error:",error);
        return Response.json({ok:false,message:"Unable to generate follow up."},{status:502});
      }
    }

    if (url.pathname === "/api/admin/clients/follow-up/save" && request.method === "POST") {
      try {
        const data=await request.json();
        const clientId=Number(data.client_id),requestId=Number(data.date_request_id);
        const body=String(data.body||"").trim();
        const subject=String(data.subject||"A little note from me").trim().slice(0,180);
        if(!Number.isInteger(clientId)||clientId<1||!Number.isInteger(requestId)||requestId<1)return Response.json({ok:false,message:"A completed date is required."},{status:400});
        if(!body)return Response.json({ok:false,message:"Generate or write a follow up first."},{status:400});
        const completed=await env.DB.prepare("SELECT id FROM date_requests WHERE id=? AND client_id=? AND status='completed' LIMIT 1").bind(requestId,clientId).first();
        if(!completed)return Response.json({ok:false,message:"This follow up must belong to a successfully completed date."},{status:400});
        const existing=await env.DB.prepare("SELECT id FROM email_drafts WHERE date_request_id=? AND email_type='after_date_follow_up' LIMIT 1").bind(requestId).first();
        if(existing){
          await env.DB.prepare("UPDATE email_drafts SET subject=?,body=?,status='draft' WHERE id=?").bind(subject,body,existing.id).run();
          return Response.json({ok:true,draft_id:existing.id,message:"Follow up draft saved."});
        }
        const result=await env.DB.prepare("INSERT INTO email_drafts (client_id,date_request_id,email_type,subject,body,status) VALUES (?,?,?,?,?,'draft')").bind(clientId,requestId,"after_date_follow_up",subject,body).run();
        return Response.json({ok:true,draft_id:result.meta?.last_row_id||null,message:"Follow up draft saved."});
      }catch(error){
        console.error("Save follow up draft error:",error);
        return Response.json({ok:false,message:"Unable to save follow up draft."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/follow-up/send" && request.method === "POST") {
      try {
        if(!env.RESEND_API_KEY)return Response.json({ok:false,message:"Email delivery is not configured."},{status:500});
        const data=await request.json();
        const clientId=Number(data.client_id);
        const requestId=Number(data.date_request_id);
        const subject=String(data.subject||"A little note from me").trim().slice(0,180);
        let body=String(data.body||"").trim();
        if(!Number.isInteger(clientId)||clientId<1)return Response.json({ok:false,message:"Choose a client first."},{status:400});
        if(!Number.isInteger(requestId)||requestId<1)return Response.json({ok:false,message:"A successfully completed date is required before sending an after date follow up."},{status:400});
        if(!body)return Response.json({ok:false,message:"Write or generate a follow up first."},{status:400});
        const completed=await env.DB.prepare("SELECT id FROM date_requests WHERE id=? AND client_id=? AND status='completed' LIMIT 1").bind(requestId,clientId).first();
        if(!completed)return Response.json({ok:false,message:"This follow up is not linked to a successfully completed date."},{status:400});
        const previouslySent=await env.DB.prepare("SELECT id,sent_at FROM email_drafts WHERE date_request_id=? AND email_type='after_date_follow_up' AND status='sent' LIMIT 1").bind(requestId).first();
        if(previouslySent && data.resend!==true)return Response.json({ok:false,already_sent:true,sent_at:previouslySent.sent_at||null,message:"An After Date Follow Up has already been sent for this completed date. Use Resend Follow Up if you intentionally want to send it again."},{status:409});
        const client=await env.DB.prepare("SELECT id,first_name,email FROM clients WHERE id=? LIMIT 1").bind(clientId).first();
        if(!client?.email)return Response.json({ok:false,message:"This client does not have an email address."},{status:400});
        body=body.replace(/\n\s*Kendra\s*$/i,"").trim()+"\n\nKendra";
        const resendResponse=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM||"Kendra Bexly <hello@kendrabexly.com>",to:[client.email],subject,text:body})});
        const resendData=await resendResponse.json().catch(()=>({}));
        if(!resendResponse.ok)throw new Error(resendData?.message||"Email provider rejected the message.");
        const existing=await env.DB.prepare("SELECT id FROM email_drafts WHERE date_request_id=? AND email_type='after_date_follow_up' LIMIT 1").bind(requestId).first();
        if(existing) await env.DB.prepare("UPDATE email_drafts SET subject=?,body=?,status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").bind(subject,body,existing.id).run();
        else await env.DB.prepare("INSERT INTO email_drafts (client_id,date_request_id,email_type,subject,body,status,sent_at) VALUES (?,?,?,?,?,'sent',CURRENT_TIMESTAMP)").bind(clientId,requestId,"after_date_follow_up",subject,body).run();
        return Response.json({ok:true,message:"Follow up sent.",email_id:resendData?.id||null});
      }catch(error){
        console.error("Follow up send error:",error);
        return Response.json({ok:false,message:"Unable to send follow up."},{status:502});
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


    if (
      url.pathname === "/api/admin/blacklist/add" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();
        const clientId = Number(data.client_id);
        const reason = String(data.reason || "").trim();
        if (!Number.isInteger(clientId) || clientId <= 0) {
          return Response.json({ ok:false, message:"A valid client is required." }, { status:400 });
        }
        if (!reason) {
          return Response.json({ ok:false, message:"Please enter a reason for blacklisting this client." }, { status:400 });
        }
        const client = await env.DB.prepare("SELECT id, first_name, last_name, email, phone FROM clients WHERE id = ?").bind(clientId).first();
        if (!client) return Response.json({ ok:false, message:"Client not found." }, { status:404 });
        const existing = await env.DB.prepare("SELECT id FROM blacklist WHERE client_id = ? OR (email <> '' AND LOWER(email) = LOWER(?)) OR (phone <> '' AND phone = ?) LIMIT 1").bind(clientId, client.email || "", client.phone || "").first();
        if (existing) return Response.json({ ok:false, message:"This client is already blacklisted." }, { status:409 });
        const name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim();
        await env.DB.prepare("INSERT INTO blacklist (client_id, name, email, phone, reason) VALUES (?, ?, ?, ?, ?)").bind(clientId, name, client.email || "", client.phone || "", reason).run();
        await env.DB.prepare("UPDATE clients SET status='do_not_book' WHERE id=?").bind(clientId).run();
        await env.DB.prepare("UPDATE date_requests SET status='declined' WHERE client_id=? AND status='pending'").bind(clientId).run();
        return Response.json({ ok:true, client_status:"do_not_book" });
      } catch (error) {
        console.error("Add blacklist error:", error);
        return Response.json({ ok:false, message:"Unable to blacklist this client." }, { status:500 });
      }
    }


    if (
      url.pathname === "/api/admin/blacklist/remove" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();
        const id = Number(data.id);
        if (!Number.isInteger(id) || id <= 0) {
          return Response.json({ ok:false, message:"A valid blacklist record is required." }, { status:400 });
        }
        const record=await env.DB.prepare("SELECT client_id FROM blacklist WHERE id=? LIMIT 1").bind(id).first();
        await env.DB.prepare("DELETE FROM blacklist WHERE id = ?").bind(id).run();
        if(record?.client_id) await env.DB.prepare("UPDATE clients SET status='active' WHERE id=?").bind(record.client_id).run();
        return Response.json({ ok:true });
      } catch (error) {
        console.error("Remove blacklist error:", error);
        return Response.json({ ok:false, message:"Unable to remove this client from the blacklist." }, { status:500 });
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
    if (
      url.pathname === "/api/admin/email-drafts/clear" &&
      request.method === "POST"
    ) {
      try {
        const result = await env.DB.prepare(
          "DELETE FROM email_drafts WHERE COALESCE(status, 'draft') != 'sent'"
        ).run();
        return Response.json({ ok:true, deleted:Number(result.meta?.changes || 0) });
      } catch (error) {
        console.error("Clear email drafts error:", error);
        return Response.json({ ok:false, message:"Unable to clear email drafts." }, { status:500 });
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
    // SEND CLIENT EMAIL DRAFT
    // =========================================================
    if (
      url.pathname.match(/^\/api\/admin\/email-drafts\/\d+\/send$/) &&
      request.method === "POST"
    ) {
      try {
        if (!env.RESEND_API_KEY) {
          return Response.json({ ok:false, message:"Email delivery is not configured." }, { status:500 });
        }
        const draftId = Number(url.pathname.split("/").slice(-2, -1)[0]);
        const draft = await env.DB.prepare(`
          SELECT ed.id, ed.subject, ed.body, ed.status, c.email, c.first_name
          FROM email_drafts ed
          LEFT JOIN clients c ON c.id = ed.client_id
          WHERE ed.id = ?
        `).bind(draftId).first();
        if (!draft) return Response.json({ ok:false, message:"Email draft not found." }, { status:404 });
        if (!draft.email) return Response.json({ ok:false, message:"This client does not have an email address." }, { status:400 });
        if (draft.status === "sent") return Response.json({ ok:false, message:"This email has already been sent." }, { status:400 });

        const esc = (value) => String(value || "")
          .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
        const html = '<div style="font-family:Arial,sans-serif;line-height:1.65;color:#29282d;white-space:normal;">' +
          esc(draft.body).replace(/\n/g,"<br>") + "</div>";
        const sendResponse = await fetch("https://api.resend.com/emails", {
          method:"POST",
          headers:{"Authorization":"Bearer " + env.RESEND_API_KEY,"Content-Type":"application/json"},
          body:JSON.stringify({
            from:"Kendra Bexly <hello@kendrabexly.com>",
            to:[draft.email],
            subject:draft.subject,
            html
          })
        });
        if (!sendResponse.ok) {
          console.error("Client email delivery failed:", sendResponse.status, await sendResponse.text());
          return Response.json({ ok:false, message:"Email delivery failed. The draft was not marked sent." }, { status:502 });
        }
        await env.DB.prepare("UPDATE email_drafts SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(draftId).run();
        return Response.json({ ok:true, message:"Email sent to " + draft.email + ".", status:"sent" });
      } catch (error) {
        console.error("Client email send error:", error);
        return Response.json({ ok:false, message:"Unable to send this email." }, { status:500 });
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
              dr.notes,
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

        const notesText = String(existingRequest.notes || "");
        const durationMatch = notesText.match(/Duration:\s*([^\n]+)/i);
        const offerMatch = notesText.match(/Offer:\s*([\s\S]*?)(?=\n(?:Date type:|Appointment type:|Duration:|Request details:|Screening requirement|25% deposit)|$)/i);
        const specialRateMatch = offerMatch?.[1]?.match(/for\s+\$([\d,]+)/i);

        const standardRates = {
          "1-hour": 500,
          "1 hour": 500,
          "2-hours": 750,
          "2 hours": 750,
          "3-hours": 1000,
          "3 hours": 1000,
          "4-hours": 1250,
          "4 hours": 1250
        };

        const durationKey = String(durationMatch?.[1] || "").trim().toLowerCase();
        const specialRate = specialRateMatch
          ? Number(specialRateMatch[1].replace(/,/g, ""))
          : 0;
        const bookingRate = specialRate || standardRates[durationKey] || 0;
        const depositAmount = bookingRate > 0
          ? Math.round(bookingRate * 0.25 * 100) / 100
          : 0;

        await env.DB
          .prepare(`
            UPDATE date_requests
            SET status = 'pending_final_approval',
                deposit_amount = ?
            WHERE id = ?
          `)
          .bind(depositAmount, requestId)
          .run();

        if (bookingRate > 0) {
          const depositDisplay = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD"
          }).format(depositAmount);

          await env.DB.prepare(`
            INSERT INTO email_drafts (
              client_id,
              date_request_id,
              email_type,
              subject,
              body,
              status
            )
            VALUES (?, ?, ?, ?, ?, 'draft')
          `).bind(
            existingRequest.client_id,
            requestId,
            "pending_final_approval",
            "A few details before our date",
            `Hi ${existingRequest.first_name},

I'd love to move forward with your request.

Date: ${existingRequest.requested_date}
Time: ${existingRequest.requested_time}

To complete final approval, please reply directly to this email with your ID attached and send your ${depositDisplay} deposit.

Please note: your deposit must be received no later than 4 hours before our scheduled date and time. After that cutoff, I won't be able to confirm the deposit or complete the booking.

Payment options:
• Gift Card — payment button coming soon
• Crypto — payment button coming soon (15% conversion fee applies)

If you choose crypto, the payment amount will be your deposit plus a 15% conversion fee.

Once I have both your ID and deposit, I'll personally review everything and confirm our date.

Kendra`
          ).run();
        }

        return Response.json({
          ok: true,
          message: "Request moved forward.",
          status: "pending_final_approval",
          deposit_amount: depositAmount,
          booking_rate: bookingRate
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
    // CONFIRM DEPOSIT
    // ============================================================
    if (
      url.pathname === "/api/admin/request/confirm-deposit" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();
        const requestId = Number(data.id);
        if (!Number.isInteger(requestId) || requestId < 1) {
          return Response.json({ ok:false, message:"Invalid request ID." }, { status:400 });
        }

        const item = await env.DB.prepare(
          "SELECT id, status, deposit_amount, deposit_paid, requested_date, requested_time, notes FROM date_requests WHERE id = ? LIMIT 1"
        ).bind(requestId).first();
        if (!item) return Response.json({ ok:false, message:"Request not found." }, { status:404 });
        if (Number(item.deposit_amount || 0) <= 0) {
          return Response.json({ ok:false, message:"Expected deposit must be calculated before confirming payment." }, { status:400 });
        }

        const appointmentLocal = new Date(String(item.requested_date || "") + "T" + String(item.requested_time || "") + ":00-07:00");
        const depositCutoff = new Date(appointmentLocal.getTime() - 4 * 60 * 60 * 1000);
        if (Number.isFinite(depositCutoff.getTime()) && Date.now() > depositCutoff.getTime()) {
          return Response.json(
            {
              ok:false,
              message:"The deposit deadline has passed. Deposits must be received no later than 4 hours before the scheduled date."
            },
            { status:400 }
          );
        }

        const existingStamp = String(item.notes || "").match(/Deposit received at: ([^\n]+)/);
        const paidAt = existingStamp?.[1] || new Date().toISOString();
        let notes = String(item.notes || "");
        if (!existingStamp) notes += (notes ? "\n" : "") + "Deposit received at: " + paidAt;

        await env.DB.prepare(
          "UPDATE date_requests SET deposit_paid = 1, notes = ? WHERE id = ?"
        ).bind(notes, requestId).run();

        return Response.json({
          ok:true,
          status:item.status,
          deposit_amount:Number(item.deposit_amount),
          remaining_balance:Math.round(Number(item.deposit_amount) * 3 * 100) / 100
        });
      } catch (error) {
        console.error("Confirm deposit error:", error);
        return Response.json({ ok:false, message:"Unable to confirm deposit." }, { status:500 });
      }
    }

    if (url.pathname === "/api/admin/request/complete" && request.method === "POST") {
      try {
        const data=await request.json();
        const requestId=Number(data.id);
        if(!Number.isInteger(requestId)||requestId<1)return Response.json({ok:false,message:"Invalid request ID."},{status:400});
        const item=await env.DB.prepare(`SELECT dr.id,dr.client_id,dr.status,dr.requested_date,dr.requested_time,c.first_name,c.notes FROM date_requests dr JOIN clients c ON c.id=dr.client_id WHERE dr.id=? LIMIT 1`).bind(requestId).first();
        if(!item)return Response.json({ok:false,message:"Request not found."},{status:404});
        if(item.status!=="approved")return Response.json({ok:false,message:"Only an approved date can be marked successfully completed."},{status:400});
        await env.DB.prepare("UPDATE date_requests SET status='completed' WHERE id=?").bind(requestId).run();
        let body=`Hi ${item.first_name || ""},

I just wanted to say I really enjoyed our time together. Thank you for making it such an easy, enjoyable date. I hope you made it home safely. 💋`;
        if(env.AI){
          try{
            try{await env.DB.prepare("ALTER TABLE clients ADD COLUMN preferences TEXT").run();}catch(e){}
            const profile=await env.DB.prepare("SELECT preferences FROM clients WHERE id=? LIMIT 1").bind(item.client_id).first();
            const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
              {role:"system",content:"Write a short private follow up immediately after a successfully completed date. Write in my first person voice as an adult independent professional companion. Sound informal, feminine, warm, appreciative, personal, and lightly flirty. Do not sound like customer service. Do not pressure him to book again. Never invent memories or details. Never refer to me by name or in third person. Avoid poetic language. Do not use hyphens, em dashes, or en dashes."},
              {role:"user",content:"Client first name: "+String(item.first_name||"")+"\nKnown preferences: "+String(profile?.preferences||"")+"\nPrivate notes: "+String(item.notes||"")}
            ],max_tokens:300,temperature:0.72});
            const generated=String(ai?.response||ai?.result?.response||"").trim().replace(/^["“]|["”]$/g,"").replace(/[–—]/g,",");
            if(generated)body=generated;
          }catch(e){console.error("Automatic after date draft generation error:",e);}
        }
        body=String(body||"").trim().replace(/\n\s*Kendra\s*$/i,"").trim()+"\n\nKendra";
        const existing=await env.DB.prepare("SELECT id FROM email_drafts WHERE date_request_id=? AND email_type='after_date_follow_up' LIMIT 1").bind(requestId).first();
        if(!existing)await env.DB.prepare("INSERT INTO email_drafts (client_id,date_request_id,email_type,subject,body,status) VALUES (?,?,?,?,?,'draft')").bind(item.client_id,requestId,"after_date_follow_up","A little note after our date",body).run();
        return Response.json({ok:true,status:"completed",follow_up_drafted:true,message:"Date marked successfully completed. Your after date follow up draft is ready for review."});
      } catch(error){
        console.error("Complete date error:",error);
        return Response.json({ok:false,message:"Unable to mark this date completed."},{status:500});
      }
    }

    // ============================================================
    // RETENTION FOLLOW-UP STATUS
    // ============================================================
    if (url.pathname === "/api/admin/retention/follow-up-status" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(`
          WITH retention AS (
            SELECT client_id,
              MAX(CASE WHEN status='sent' THEN sent_at END) AS sent_at,
              MAX(CASE WHEN status='draft' THEN created_at END) AS draft_at
            FROM email_drafts
            WHERE email_type='retention_follow_up'
            GROUP BY client_id
          )
          SELECT r.client_id, r.sent_at, r.draft_at, c.first_name, c.last_name,
            CASE
              WHEN instr(COALESCE((SELECT body FROM email_drafts e2 WHERE e2.client_id=r.client_id AND e2.email_type='retention_follow_up' ORDER BY COALESCE(e2.sent_at,e2.created_at) DESC LIMIT 1),''),'RETENTION_OFFER:experience-upgrade')>0 THEN 'experience-upgrade'
              WHEN instr(COALESCE((SELECT body FROM email_drafts e2 WHERE e2.client_id=r.client_id AND e2.email_type='retention_follow_up' ORDER BY COALESCE(e2.sent_at,e2.created_at) DESC LIMIT 1),''),'RETENTION_OFFER:special-rate')>0 THEN 'special-rate'
              WHEN instr(COALESCE((SELECT body FROM email_drafts e2 WHERE e2.client_id=r.client_id AND e2.email_type='retention_follow_up' ORDER BY COALESCE(e2.sent_at,e2.created_at) DESC LIMIT 1),''),'RETENTION_OFFER:extra-time')>0 THEN 'extra-time'
              ELSE 'untracked'
            END AS offer_strategy,
            CASE WHEN r.sent_at IS NOT NULL THEN 'sent' WHEN r.draft_at IS NOT NULL THEN 'draft' ELSE 'none' END AS status,
            (
              SELECT MIN(dr.requested_date)
              FROM date_requests dr
              WHERE dr.client_id=r.client_id
                AND r.sent_at IS NOT NULL
                AND datetime(COALESCE(dr.created_at, dr.requested_date || ' 00:00:00')) > datetime(r.sent_at)
            ) AS requested_after_contact,
            (
              SELECT MIN(dr.requested_date)
              FROM date_requests dr
              WHERE dr.client_id=r.client_id
                AND r.sent_at IS NOT NULL
                AND lower(COALESCE(dr.status,'')) IN ('approved','completed')
                AND datetime(COALESCE(dr.created_at, dr.requested_date || ' 00:00:00')) > datetime(r.sent_at)
            ) AS booked_after_contact
          FROM retention r
        `).all();
        return Response.json({ok:true,clients:result.results||[]});
      } catch(error) {
        console.error("Retention follow-up status error:",error);
        return Response.json({ok:false,message:"Unable to load retention follow-up status."},{status:500});
      }
    }

    // ============================================================
    // RETENTION FOLLOW-UP PREVIEW
    // ============================================================
    if (url.pathname === "/api/admin/retention/follow-up-preview" && request.method === "POST") {
      try {
        const data=await request.json();
        const clientId=Number(data.client_id);
        const allowed=new Set(["extra-time","experience-upgrade","special-rate"]);
        const strategy=allowed.has(String(data.offer_strategy||""))?String(data.offer_strategy):"extra-time";
        if(!Number.isInteger(clientId)||clientId<1) return Response.json({ok:false,message:"Choose a valid client."},{status:400});
        const client=await env.DB.prepare("SELECT id,first_name,last_name,notes FROM clients WHERE id=? LIMIT 1").bind(clientId).first();
        if(!client) return Response.json({ok:false,message:"Client not found."},{status:404});
        const blocked=await env.DB.prepare("SELECT id FROM blacklist WHERE client_id=? LIMIT 1").bind(clientId).first().catch(()=>null);
        if(blocked) return Response.json({ok:false,message:"Blacklisted clients cannot receive retention follow-ups."},{status:400});
        const dates=await env.DB.prepare("SELECT id,requested_date,requested_time,status,notes FROM date_requests WHERE client_id=? ORDER BY requested_date DESC,requested_time DESC").bind(clientId).all();
        const rows=dates.results||[], now=Date.now();
        const completed=rows.filter(r=>{const st=String(r.status||"").toLowerCase();if(st==="completed")return true;if(st!=="approved"||!r.requested_date)return false;const t=new Date(String(r.requested_date)+"T"+String(r.requested_time||"00:00")).getTime();return Number.isFinite(t)&&t<now;});
        const upcoming=rows.some(r=>String(r.status||"").toLowerCase()==="approved"&&r.requested_date&&new Date(String(r.requested_date)+"T"+String(r.requested_time||"00:00")).getTime()>=now);
        if(!completed.length) return Response.json({ok:false,message:"Retention follow-ups require at least one successfully completed date."},{status:400});
        if(upcoming) return Response.json({ok:false,message:"This client already has an upcoming confirmed date."},{status:400});
        const frequency=String(data.frequency||"quarterly");
        const frequencyDays=frequency==="monthly"?30:frequency==="quarterly"?90:0;
        const recent=await env.DB.prepare("SELECT sent_at FROM email_drafts WHERE client_id=? AND email_type='retention_follow_up' AND status='sent' ORDER BY sent_at DESC LIMIT 1").bind(clientId).first();
        if(frequencyDays&&recent?.sent_at){
          const sentMs=new Date(String(recent.sent_at).replace(" ","T")+"Z").getTime();
          const elapsedDays=Number.isFinite(sentMs)?Math.floor((Date.now()-sentMs)/86400000):frequencyDays;
          if(elapsedDays<frequencyDays) return Response.json({ok:false,message:"This client is not eligible for another retention offer yet. The current cadence allows one every "+frequencyDays+" days."},{status:409});
        }
        const last=completed[0];
        const offer=strategy==="extra-time"?"an extra 30 minutes":strategy==="experience-upgrade"?"a special experience upgrade":"a special rate";
        const tone=String(data.tone||"warm-personal");
        const expirationValue=String(data.expiration||"14");
        const expirationDays=["7","14","30"].includes(expirationValue)?Number(expirationValue):null;
        const expirationDate=expirationDays?new Date(Date.now()+expirationDays*86400000):null;
        const expirationText=expirationDate?expirationDate.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"America/Los_Angeles"}):"";
        const expirationInstruction=expirationDays?("The incentive expires on "+expirationText+". Mention the deadline naturally in one short sentence without sounding promotional or urgent."):"No automatic expiration is set. Do not invent an expiration date or deadline.";
        const toneInstructions={"warm-personal":"warm, personal, and inviting","flirty":"lightly flirty, feminine, and natural","playful":"light, playful, and personable","soft-sensual":"soft, subtly sensual, and natural without poetic language","direct":"clear, concise, and personal"};
        const useFirstName=data.useFirstName!==false, usePreferences=data.usePreferences!==false, useHistory=data.useHistory!==false;
        const greetingName=useFirstName?String(client.first_name||""):"";
        const allowedNotes=usePreferences?String(client.notes||""):"";
        const allowedHistory=useHistory?("Completed dates: "+completed.length+"\nLast completed: "+String(last.requested_date||"")+"\nLast date notes: "+String(last.notes||"")):"Do not reference prior date count, date timing, or date notes.";
        let body=`Hi${greetingName ? " "+greetingName : ""},\n\nYou crossed my mind, so I wanted to say hello. I enjoyed seeing you and would love to spend time together again when the timing feels right. I have ${offer} available for a future date.${expirationDays ? " It will be available through "+expirationText+"." : ""}\n\nKendra`;
        if(env.AI){try{const ai=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[{role:"system",content:"Write a short private retention email in first person. Use this voice: "+(toneInstructions[tone]||toneInstructions["warm-personal"])+". Never sound poetic, robotic, or like mass marketing. Do not invent memories. Do not pressure the client. Do not invent prices, discounts, amounts, or terms. No hyphens or dash punctuation. Follow the personalization permissions exactly. Return only the body without a signature."},{role:"user",content:"Client first name permission: "+(useFirstName?String(client.first_name||""):"DO NOT USE CLIENT NAME")+"\nSaved preferences/notes permission: "+(usePreferences?(allowedNotes||"No saved preferences"):"DO NOT REFERENCE SAVED PREFERENCES OR NOTES")+"\nClient history permission: "+allowedHistory+"\nOffer: "+offer+"\nExpiration rule: "+expirationInstruction+"\nMention the offer naturally."}],max_tokens:350,temperature:.75});const generated=String(ai?.response||ai?.result?.response||"").trim().replace(/^[\"“]|[\"”]$/g,"").replace(/[–—]/g,",");if(generated)body=generated+"\n\nKendra";}catch(e){console.error("Retention preview generation error:",e);}}
        return Response.json({ok:true,subject:"A little hello",body,offer_strategy:strategy});
      } catch(error) {
        console.error("Retention follow-up preview error:",error);
        return Response.json({ok:false,message:"Unable to preview retention follow-up."},{status:500});
      }
    }

    // ============================================================
    // RETENTION FOLLOW-UP DRAFT
    // ============================================================
    if (url.pathname === "/api/admin/retention/follow-up-draft" && request.method === "POST") {
      try {
        const data = await request.json();
        const clientId = Number(data.client_id);
        const allowedOfferStrategies = new Set(["extra-time","experience-upgrade","special-rate"]);
        const offerStrategy = allowedOfferStrategies.has(String(data.offer_strategy||"")) ? String(data.offer_strategy) : "extra-time";
        if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ok:false,message:"Choose a valid client."},{status:400});
        const client = await env.DB.prepare("SELECT id,first_name,last_name,email,notes FROM clients WHERE id=? LIMIT 1").bind(clientId).first();
        if (!client) return Response.json({ok:false,message:"Client not found."},{status:404});
        const blocked = await env.DB.prepare("SELECT id FROM blacklist WHERE client_id=? LIMIT 1").bind(clientId).first().catch(()=>null);
        if (blocked) return Response.json({ok:false,message:"Blacklisted clients cannot receive retention follow-ups."},{status:400});
        const dates = await env.DB.prepare("SELECT id,requested_date,requested_time,status,notes FROM date_requests WHERE client_id=? ORDER BY requested_date DESC, requested_time DESC").bind(clientId).all();
        const rows = dates.results || [];
        const now = Date.now();
        const completed = rows.filter(r => {
          const status=String(r.status||"").toLowerCase();
          if(status==="completed") return true;
          if(status!=="approved"||!r.requested_date) return false;
          const when=new Date(String(r.requested_date)+"T"+String(r.requested_time||"00:00")).getTime();
          return Number.isFinite(when)&&when<now;
        });
        const upcoming = rows.some(r => String(r.status||"").toLowerCase()==="approved" && r.requested_date && new Date(String(r.requested_date)+"T"+String(r.requested_time||"00:00")).getTime()>=now);
        if (!completed.length) return Response.json({ok:false,message:"Retention follow-ups require at least one successfully completed date."},{status:400});
        const eligibility=String(data.eligibility||"completed");
        if(eligibility==="returning" && completed.length<2) return Response.json({ok:false,message:"This retention plan is limited to returning clients with at least two completed dates."},{status:409});
        if (upcoming) return Response.json({ok:false,message:"This client already has an upcoming confirmed date."},{status:400});
        const last = completed[0];
        const offerLabel = offerStrategy==="extra-time" ? "an extra 30 minutes" : offerStrategy==="experience-upgrade" ? "a special experience upgrade" : "a special rate";
        let body = `Hi ${client.first_name || ""},\n\nYou crossed my mind, so I wanted to say hello. I enjoyed seeing you and would love to spend time together again when the timing feels right. I have ${offerLabel} available for a future date.\n\nKendra`;
        if (env.AI) {
          try {
            const ai = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{messages:[
              {role:"system",content:"Write a short private retention follow-up email in my first person voice as an adult independent professional companion. It is for a client who has already completed a date with me. Sound natural, feminine, warm, personal, lightly flirty, and never like mass marketing. Do not invent memories or details. Do not pressure the client to book. Protect my pricing: do not invent or reduce rates and do not promise a discount. If an incentive is appropriate, prefer mentioning that I may have something special available rather than naming an unverified offer. No poetic language. No hyphens, em dashes, or en dashes. Return only the email body without a signature."},
              {role:"user",content:"Client first name: "+String(client.first_name||"")+"\nCompleted dates: "+completed.length+"\nLast completed date: "+String(last.requested_date||"")+"\nClient notes: "+String(client.notes||"")+"\nLast date notes: "+String(last.notes||"")+"\nRetention offer strategy: "+offerLabel+"\nInclude this incentive naturally without inventing any rate, amount, or additional terms."}
            ],max_tokens:350,temperature:0.75});
            const generated=String(ai?.response||ai?.result?.response||"").trim().replace(/^[\"“]|[\"”]$/g,"").replace(/[–—]/g,",");
            if(generated) body=generated+"\n\nKendra";
          } catch(e) { console.error("Retention draft generation error:",e); }
        }
        const reviewedSubject = String(data.subject || "").trim();
        const reviewedBody = String(data.body || "").trim();
        if (reviewedBody) body = reviewedBody;
        const draftSubject = reviewedSubject || "A little hello";
        const frequency=String(data.frequency||"quarterly");
        const frequencyDays=frequency==="monthly"?30:frequency==="quarterly"?90:0;
        const latestSent=await env.DB.prepare("SELECT sent_at FROM email_drafts WHERE client_id=? AND email_type='retention_follow_up' AND status='sent' ORDER BY sent_at DESC LIMIT 1").bind(clientId).first();
        if(frequencyDays&&latestSent?.sent_at){
          const sentMs=new Date(String(latestSent.sent_at).replace(" ","T")+"Z").getTime();
          const elapsedDays=Number.isFinite(sentMs)?Math.floor((Date.now()-sentMs)/86400000):frequencyDays;
          if(elapsedDays<frequencyDays) return Response.json({ok:false,message:"This client is not eligible for another retention offer yet. The current cadence allows one every "+frequencyDays+" days."},{status:409});
        }
        const existing = await env.DB.prepare("SELECT id FROM email_drafts WHERE client_id=? AND email_type='retention_follow_up' AND status='draft' LIMIT 1").bind(clientId).first();
        if(existing) {
          await env.DB.prepare("UPDATE email_drafts SET subject=?,body=? WHERE id=?").bind(draftSubject,body+"\n\n<!-- RETENTION_OFFER:"+offerStrategy+" -->",existing.id).run();
          return Response.json({ok:true,id:existing.id,updated:true,message:"Retention follow-up draft refreshed."});
        }
        const result=await env.DB.prepare("INSERT INTO email_drafts (client_id,date_request_id,email_type,subject,body,status) VALUES (?,?,?,?,?,'draft')").bind(clientId,last.id,"retention_follow_up",draftSubject,body+"\n\n<!-- RETENTION_OFFER:"+offerStrategy+" -->").run();
        return Response.json({ok:true,id:result.meta.last_row_id,message:"Retention follow-up draft created."});
      } catch(error) {
        console.error("Retention follow-up draft error:",error);
        return Response.json({ok:false,message:"Unable to create retention follow-up draft."},{status:500});
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

        const existingRequest = await env.DB
          .prepare(`
            SELECT id, status, notes, deposit_paid, id_received, final_approval
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

        if (!["pending_final_approval", "screening_pending"].includes(existingRequest.status)) {
          return Response.json(
            {
              ok: false,
              message: "Request is not pending final approval."
            },
            { status: 400 }
          );
        }

        const hasNewsletterSpecial =
          String(existingRequest.notes || "").includes("Newsletter special: Newsletter #");

        if (!existingRequest.deposit_paid) {
          return Response.json(
            { ok:false, message:"Deposit must be confirmed before final approval." },
            { status:400 }
          );
        }

        if (!existingRequest.id_received && data.id_received !== true) {
          return Response.json(
            { ok:false, message:"ID screening must be completed before final approval." },
            { status:400 }
          );
        }

        if (hasNewsletterSpecial && data.newsletter_special_approved !== true) {
          return Response.json(
            {
              ok: false,
              message: "Approve the attached newsletter special before final approval."
            },
            { status: 400 }
          );
        }

        if (hasNewsletterSpecial) {
          const updatedNotes =
            String(existingRequest.notes || "") + "\nNewsletter special approved: Yes";
          await env.DB.prepare(
            "UPDATE date_requests SET notes = ? WHERE id = ?"
          ).bind(updatedNotes, requestId).run();
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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_scheduled_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,draft_id INTEGER NOT NULL UNIQUE,scheduled_for TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`).run();
      const due=await env.DB.prepare(`SELECT s.id AS schedule_id,s.draft_id,d.content,d.status AS draft_status
        FROM x_scheduled_posts s JOIN x_post_drafts d ON d.id=s.draft_id
        WHERE s.status='scheduled' AND s.scheduled_for<=? ORDER BY s.scheduled_for ASC LIMIT 10`).bind(new Date().toISOString()).all();
      for(const item of (due.results||[])){
        if(item.draft_status!=="approved"){await env.DB.prepare("UPDATE x_scheduled_posts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.schedule_id).run();continue;}
        try{
          let row=await env.DB.prepare("SELECT access_token,refresh_token,expires_at,scope FROM x_oauth_tokens WHERE id=1").first();
          if(!row) throw new Error("X is not connected.");
          let accessToken=row.access_token;const now=Math.floor(Date.now()/1000);
          if(Number(row.expires_at||0)<=now+300){
            if(!row.refresh_token)throw new Error("X reconnect required.");
            const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:row.refresh_token,client_id:env.X_CLIENT_ID});
            const basic=btoa(String(env.X_CLIENT_ID)+":"+String(env.X_CLIENT_SECRET));
            const rr=await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+basic,"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:body.toString()});
            if(!rr.ok)throw new Error("X token refresh failed.");
            const tokens=await rr.json();accessToken=tokens.access_token;
            await env.DB.prepare("UPDATE x_oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,scope=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(accessToken,tokens.refresh_token||row.refresh_token,now+Number(tokens.expires_in||7200),tokens.scope||row.scope||null).run();
          }
          const xr=await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify(await (async()=>{const mediaId=await uploadXImage(env,item.draft_id,accessToken);return mediaId?{text:item.content,media:{media_ids:[mediaId]}}:{text:item.content};})())});
          const xd=await xr.json().catch(()=>({}));if(!xr.ok)throw new Error(xd?.detail||xd?.title||"X rejected scheduled post.");
          const postId=xd?.data?.id||null;
          await env.DB.prepare("UPDATE x_post_drafts SET status='published',x_post_id=?,published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'").bind(postId,item.draft_id).run();
          await env.DB.prepare("UPDATE x_scheduled_posts SET status='published',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.schedule_id).run();
        }catch(error){console.error("Scheduled X publish failed",item.schedule_id,error);}
      }
    })());
  }
};
