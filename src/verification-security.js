const ALL_VERIFICATION_PERMISSIONS = [
  "view_id_images",
  "edit_verification",
  "run_persona",
  "final_decision",
  "delete_sensitive"
];

function decodeBase64UrlJson(value) {
  try {
    const normalized=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
    const padded=normalized+"=".repeat((4-normalized.length%4)%4);
    return JSON.parse(atob(padded));
  } catch { return {}; }
}

export function accessIdentity(request) {
  const email=String(request.headers.get("Cf-Access-Authenticated-User-Email")||"").trim().toLowerCase();
  const assertion=String(request.headers.get("Cf-Access-Jwt-Assertion")||"").trim();
  const payload=assertion.includes(".") ? decodeBase64UrlJson(assertion.split(".")[1]) : {};
  return {
    email: email || String(payload.email||"").trim().toLowerCase(),
    subject: String(payload.sub||""),
    issued_at: Number(payload.iat||0),
    expires_at: Number(payload.exp||0),
    has_assertion: Boolean(assertion)
  };
}

function allowedAdminEmails(env) {
  return new Set(String(env.VERIFICATION_ADMIN_EMAILS||"")
    .split(",").map(v=>v.trim().toLowerCase()).filter(Boolean));
}

function configuredPermissions(env, email) {
  const raw=String(env.VERIFICATION_PERMISSIONS_JSON||"").trim();
  if(!raw) return null;
  try {
    const parsed=JSON.parse(raw);
    const value=parsed[email] ?? parsed["*"];
    return Array.isArray(value) ? new Set(value.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function authorizeVerificationRequest(request, env, permission, {fresh=false,freshSeconds=900}={}) {
  const identity=accessIdentity(request);
  if(!identity.email) {
    return {ok:false,status:403,code:"verification_admin_required",message:"Authorized verification administrator access is required.",identity};
  }
  const allowlist=allowedAdminEmails(env);
  if(allowlist.size && !allowlist.has(identity.email)) {
    return {ok:false,status:403,code:"verification_admin_forbidden",message:"This administrator is not authorized for verification records.",identity};
  }
  const configured=configuredPermissions(env,identity.email);
  const permissions=configured ?? new Set(ALL_VERIFICATION_PERMISSIONS);
  if(permission && !permissions.has(permission)) {
    return {ok:false,status:403,code:"verification_permission_denied",message:"You do not have permission to perform this verification action.",identity};
  }
  if(fresh) {
    const now=Math.floor(Date.now()/1000);
    const recent=identity.has_assertion && identity.issued_at>0 && now-identity.issued_at<=freshSeconds && (!identity.expires_at || identity.expires_at>now);
    if(!recent) {
      return {ok:false,status:403,code:"reauth_required",message:"Re-authentication is required before this sensitive action.",identity};
    }
  }
  return {ok:true,status:200,identity,permissions:[...permissions]};
}

export function verificationForbidden(result) {
  return Response.json({
    ok:false,
    code:result.code||"verification_permission_denied",
    message:result.message||"Verification access denied.",
    reauth_required:result.code==="reauth_required"
  },{status:result.status||403,headers:{"Cache-Control":"private, no-store"}});
}

export function sanitizeVerificationActivity(value) {
  let text=String(value||"").slice(0,2000);
  text=text.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi,"Bearer [REDACTED]");
  text=text.replace(/\b(?:sk|pk|key|secret|token)_[A-Za-z0-9_-]{8,}\b/gi,"[REDACTED]");
  text=text.replace(/\b(?:PERSONA_API_KEY|PERSONA_WEBHOOK_SECRET|VERIFICATION_FIELD_ENCRYPTION_KEY)\s*[:=]\s*\S+/gi,"$1=[REDACTED]");
  text=text.replace(/\b(?:DL|ID|license)\s*(?:number|#)?\s*[:=]\s*[A-Z0-9-]{5,}\b/gi,"ID number: [REDACTED]");
  return text;
}

export function retentionDate(value) {
  const text=String(value||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const d=new Date(text+"T00:00:00Z");
  return Number.isNaN(d.getTime()) ? "" : text;
}

export async function enforceVerificationRateLimit(env, scope, key, limit, windowSeconds) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS verification_rate_limits (
      scope TEXT NOT NULL,
      rate_key TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(scope, rate_key)
    )
  `).run();
  const now=Math.floor(Date.now()/1000);
  const safeScope=String(scope||"verification").slice(0,80);
  const safeKey=String(key||"unknown").slice(0,200);
  const row=await env.DB.prepare("SELECT window_started_at, request_count FROM verification_rate_limits WHERE scope=? AND rate_key=?")
    .bind(safeScope,safeKey).first();
  if(!row || now-Number(row.window_started_at||0)>=windowSeconds) {
    await env.DB.prepare(`
      INSERT INTO verification_rate_limits(scope,rate_key,window_started_at,request_count)
      VALUES(?,?,?,1)
      ON CONFLICT(scope,rate_key) DO UPDATE SET window_started_at=excluded.window_started_at,request_count=1
    `).bind(safeScope,safeKey,now).run();
    return {ok:true,remaining:Math.max(0,limit-1),retry_after:0};
  }
  const count=Number(row.request_count||0);
  if(count>=limit) {
    return {ok:false,remaining:0,retry_after:Math.max(1,windowSeconds-(now-Number(row.window_started_at||0)))};
  }
  await env.DB.prepare("UPDATE verification_rate_limits SET request_count=request_count+1 WHERE scope=? AND rate_key=?").bind(safeScope,safeKey).run();
  return {ok:true,remaining:Math.max(0,limit-count-1),retry_after:0};
}

export function personaFetchState(error) {
  if(error?.name==="AbortError" || error?.name==="TimeoutError") {
    return {code:"persona_timeout",message:"Persona request timed out. Refresh Persona Status before starting another transaction."};
  }
  return {code:"persona_unavailable",message:"Persona is temporarily unavailable. Manual verification remains available."};
}
