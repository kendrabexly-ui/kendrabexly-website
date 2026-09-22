import { accessIdentity, authorizeVerificationRequest, verificationForbidden, sanitizeVerificationActivity, retentionDate, enforceVerificationRateLimit, personaFetchState } from "./verification-security.js";
async function ensureXDraftMedia(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_draft_media (draft_id INTEGER PRIMARY KEY,mime_type TEXT NOT NULL,file_name TEXT,image_base64 TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();}
async function uploadXImage(env,draftId,accessToken){await ensureXDraftMedia(env);const m=await env.DB.prepare("SELECT mime_type,image_base64 FROM x_draft_media WHERE draft_id=?").bind(draftId).first();if(!m)return null;const rr=await fetch("https://api.x.com/2/media/upload",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify({media:m.image_base64,media_category:"tweet_image"})});const d=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(d?.detail||d?.title||d?.message||"X rejected the image upload.");return d?.data?.id||d?.data?.media_id_string||d?.media_id_string||null;}


const SITE_TIME_ZONE = "America/Los_Angeles";
const VERIFICATION_ROUTE_PERMISSIONS = [
  ["/api/admin/clients/id-document/image", "view_id_images"],
  ["/api/admin/clients/id-document/retention", "delete_sensitive"],
  ["/api/admin/clients/id-document", "edit_verification"],
  ["/api/admin/clients/verification-sensitive", "delete_sensitive"],
  ["/api/admin/clients/verification-draft", "edit_verification"],
  ["/api/admin/clients/verification-activity", "edit_verification"],
  ["/api/admin/clients/verification-overview", "edit_verification"],
  ["/api/admin/clients/verification-audit", "final_decision"],
  ["/api/admin/clients/persona-status", "run_persona"],
  ["/api/admin/clients/persona-test", "run_persona"],
  ["/api/admin/clients/persona-verify", "run_persona"],
  ["/api/admin/clients/persona-refresh", "run_persona"]
];
function verificationRouteAccess(pathname, method) {
  const match=VERIFICATION_ROUTE_PERMISSIONS.find(([path])=>pathname===path || pathname.startsWith(path+"/"));
  if(!match)return null;
  const fresh=(pathname==="/api/admin/clients/id-document/image"&&method==="GET") || method==="DELETE";
  return {permission:match[1],fresh};
}

const DEFAULT_SITE_RATES_VERSION = "2026-09-20-experience-menu-v4";
const DEFAULT_SITE_RATES = [
  {
    name: "Private Introductions",
    description: "A discreet introduction for a shorter first meeting.",
    rates: [["Private Introduction — 20 minutes", 200], ["Private Uncovered Introduction — 20 minutes", 250]]
  },
  {
    name: "Brief Experiences",
    description: "A brief experience when you want a little more time to settle in and enjoy the moment.",
    rates: [["Signature Brief Introduction — 30 minutes", 300], ["Greek Princess Brief Introduction — 30 minutes", 400]]
  },
  {
    name: "Signature Girlfriend Experience",
    description: "My signature experience is romantic, flirtatious, and intentionally unhurried, with genuine chemistry, affectionate company, playful conversation, and my complete attention.",
    rates: [["1 hour", 500], ["1½ hours", 750], ["Up to 2 hours", 1000], ["Up to 4 hours", 2300]]
  },
  {
    name: "Greek Princess Experience",
    description: "My more adventurous and elevated experience, with the same warmth and attentive companionship and a more daring, playful energy.",
    rates: [["1 hour", 700], ["1½ hours", 1000], ["Up to 2 hours", 1300], ["Up to 4 hours", 2800]]
  },
  {
    name: "Outcall",
    description: "Prefer that I come to you? Outcall is available as an add-on for approved dates at upscale hotels, luxury residences, and other refined private locations.\n\nYour location must be clean, safe, discreet, and suitable for receiving a guest. Complete location details are required before final confirmation, and all outcall requests remain subject to my approval.\n\nSet the scene, make yourself comfortable, and I will bring the experience to you.",
    rates: [["Outcall", 100]],
    add_on: true
  }
];

async function ensureSiteContentTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS site_gallery (
      slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 6),
      mime_type TEXT NOT NULL,
      image_base64 TEXT NOT NULL,
      alt_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      available_date TEXT NOT NULL,
      available_time TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(available_date, available_time)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS email_tracking (
      email_draft_id INTEGER PRIMARY KEY,
      provider_email_id TEXT,
      opened_at TEXT,
      last_opened_at TEXT,
      open_count INTEGER NOT NULL DEFAULT 0,
      responded_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_work_hours (
      day_of_week INTEGER PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
      enabled INTEGER NOT NULL DEFAULT 0,
      start_time TEXT NOT NULL DEFAULT '10:00',
      end_time TEXT NOT NULL DEFAULT '22:00',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  const workHoursCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM calendar_work_hours").first();
  if (!Number(workHoursCount?.count || 0)) {
    await env.DB.batch(Array.from({ length: 7 }, (_, day) =>
      env.DB.prepare("INSERT INTO calendar_work_hours (day_of_week, enabled, start_time, end_time) VALUES (?, 0, '10:00', '22:00')").bind(day)
    ));
  }
}



function timingSafeEqualHex(a,b){
  const x=String(a||"").toLowerCase(),y=String(b||"").toLowerCase();
  if(x.length!==y.length)return false;
  let diff=0; for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);
  return diff===0;
}
async function verifyPersonaWebhookSignature(rawBody,signatureHeader,secret){
  if(!secret||!signatureHeader)return false;
  const parts=String(signatureHeader).split(",").map(v=>v.trim());
  const timestamp=parts.find(v=>v.startsWith("t="))?.slice(2)||"";
  const signatures=parts.filter(v=>v.startsWith("v1=")).map(v=>v.slice(3));
  if(!timestamp||!signatures.length)return false;
  const age=Math.abs(Math.floor(Date.now()/1000)-Number(timestamp));
  if(!Number.isFinite(age)||age>300)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"."+rawBody));
  const expected=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return signatures.some(sig=>timingSafeEqualHex(sig,expected));
}

const SCREENING_ACKNOWLEDGEMENT_WORDING = "I understand that a valid ID is required for screening before final approval.";
const SCREENING_ACKNOWLEDGEMENT_VERSION = "screening-id-v1";

async function ensureClientVerificationAuditsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      date_request_id INTEGER NOT NULL UNIQUE,
      accepted INTEGER NOT NULL DEFAULT 0,
      authorization_wording TEXT NOT NULL,
      authorization_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'pending_review',
      verification_method TEXT NOT NULL DEFAULT '',
      submitted_employer TEXT NOT NULL DEFAULT '',
      submitted_job_title TEXT NOT NULL DEFAULT '',
      submitted_industry TEXT NOT NULL DEFAULT '',
      identity_confirmed INTEGER NOT NULL DEFAULT 0,
      employer_confirmed INTEGER NOT NULL DEFAULT 0,
      job_title_confirmed INTEGER NOT NULL DEFAULT 0,
      industry_confirmed INTEGER NOT NULL DEFAULT 0,
      contact_confirmed INTEGER NOT NULL DEFAULT 0,
      evidence_notes TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT '',
      decision_notes TEXT NOT NULL DEFAULT '',
      birthdate TEXT NOT NULL DEFAULT '',
      completed_by TEXT NOT NULL DEFAULT '',
      persona_transaction_id TEXT NOT NULL DEFAULT '',
      persona_transaction_status TEXT NOT NULL DEFAULT '',
      persona_submitted_at TEXT,
      persona_updated_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const columnRows = await env.DB.prepare("PRAGMA table_info(client_verification_audits)").all();
  const columns = new Set((columnRows.results || []).map((column) => String(column.name || "")));
  const additions = [
    ["submitted_employer", "TEXT NOT NULL DEFAULT ''"],
    ["submitted_job_title", "TEXT NOT NULL DEFAULT ''"],
    ["submitted_industry", "TEXT NOT NULL DEFAULT ''"],
    ["identity_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["employer_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["job_title_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["industry_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["contact_confirmed", "INTEGER NOT NULL DEFAULT 0"],
    ["evidence_notes", "TEXT NOT NULL DEFAULT ''"],
    ["decision_reason", "TEXT NOT NULL DEFAULT ''"],
    ["decision_notes", "TEXT NOT NULL DEFAULT ''"],
    ["birthdate", "TEXT NOT NULL DEFAULT ''"],
    ["completed_by", "TEXT NOT NULL DEFAULT ''"],
    ["review_flag", "INTEGER NOT NULL DEFAULT 0"],
    ["persona_transaction_id", "TEXT NOT NULL DEFAULT ''"],
    ["persona_transaction_status", "TEXT NOT NULL DEFAULT ''"],
    ["persona_submitted_at", "TEXT"],
    ["persona_updated_at", "TEXT"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) await env.DB.prepare(`ALTER TABLE client_verification_audits ADD COLUMN ${name} ${definition}`).run();
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_decision_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      verification_status TEXT NOT NULL,
      decision_reason TEXT NOT NULL DEFAULT '',
      decision_notes TEXT NOT NULL DEFAULT '',
      verification_method TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      completed_by TEXT NOT NULL DEFAULT '',
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_client_verification_audits_client ON client_verification_audits(client_id, accepted_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_client_verification_history_client ON client_verification_decision_history(client_id, changed_at DESC)").run();
}

function verificationAuditPublicRecord(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    client_id: Number(row.client_id),
    booking_request_id: Number(row.date_request_id),
    accepted: Number(row.accepted || 0) === 1,
    authorization_wording: row.authorization_wording || "",
    authorization_version: row.authorization_version || "",
    accepted_at: row.accepted_at || "",
    verification_status: row.verification_status || "pending_review",
    verification_method: row.verification_method || "",
    submitted_employer: row.submitted_employer || "",
    submitted_job_title: row.submitted_job_title || "",
    submitted_industry: row.submitted_industry || "",
    identity_confirmed: Number(row.identity_confirmed || 0) === 1,
    employer_confirmed: Number(row.employer_confirmed || 0) === 1,
    job_title_confirmed: Number(row.job_title_confirmed || 0) === 1,
    industry_confirmed: Number(row.industry_confirmed || 0) === 1,
    contact_confirmed: Number(row.contact_confirmed || 0) === 1,
    evidence_notes: row.evidence_notes || "",
    decision_reason: row.decision_reason || "",
    decision_notes: row.decision_notes || "",
    birthdate: row.birthdate || "",
    completed_by: row.completed_by || "",
    review_flag: Number(row.review_flag || 0) === 1,
    persona_transaction_id: row.persona_transaction_id || "",
    persona_transaction_status: row.persona_transaction_status || "",
    persona_submitted_at: row.persona_submitted_at || "",
    persona_updated_at: row.persona_updated_at || "",
    completed_at: row.completed_at || "",
    updated_at: row.updated_at || ""
  };
}

async function ensureVerificationWorkspaceTables(env) {
  await ensureClientVerificationAuditsTable(env);
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_drafts (
      client_id INTEGER PRIMARY KEY,
      birthdate TEXT NOT NULL DEFAULT '',
      persona_fields_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_sensitive_fields (
      client_id INTEGER PRIMARY KEY,
      encrypted_id_number TEXT NOT NULL DEFAULT '',
      id_last4 TEXT NOT NULL DEFAULT '',
      id_class TEXT NOT NULL DEFAULT '',
      issuing_state TEXT NOT NULL DEFAULT '',
      expiration_date TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS persona_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL DEFAULT '',
      transaction_id TEXT NOT NULL DEFAULT '',
      resulting_status TEXT NOT NULL DEFAULT '',
      received_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      audit_id INTEGER,
      event_type TEXT NOT NULL,
      event_label TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_verification_activity_client
    ON client_verification_activity(client_id, created_at DESC, id DESC)
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_verification_retention (
      client_id INTEGER PRIMARY KEY,
      id_policy TEXT NOT NULL DEFAULT '',
      id_delete_at TEXT NOT NULL DEFAULT '',
      id_auto_delete INTEGER NOT NULL DEFAULT 0,
      sensitive_policy TEXT NOT NULL DEFAULT '',
      sensitive_delete_at TEXT NOT NULL DEFAULT '',
      sensitive_auto_delete INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS persona_verification_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      audit_id INTEGER,
      transaction_id TEXT NOT NULL DEFAULT '',
      transaction_status TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      replaces_attempt_id INTEGER,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_refreshed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_persona_attempts_client ON persona_verification_attempts(client_id, submitted_at DESC, id DESC)").run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS persona_webhook_health (
      id INTEGER PRIMARY KEY CHECK(id=1),
      last_received_at TEXT,
      last_success_at TEXT,
      last_rejected_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare("INSERT OR IGNORE INTO persona_webhook_health(id) VALUES(1)").run();

  const auditColumns = await env.DB.prepare("PRAGMA table_info(client_verification_audits)").all();
  const auditNames = new Set((auditColumns.results || []).map(row => String(row.name || "")));
  if (!auditNames.has("review_flag")) {
    await env.DB.prepare("ALTER TABLE client_verification_audits ADD COLUMN review_flag INTEGER NOT NULL DEFAULT 0").run();
  }

  await ensureClientIdDocumentsTable(env);
  const idColumns = await env.DB.prepare("PRAGMA table_info(client_id_documents)").all();
  const idNames = new Set((idColumns.results || []).map(row => String(row.name || "")));
  if (!idNames.has("retention_reminder_at")) {
    await env.DB.prepare("ALTER TABLE client_id_documents ADD COLUMN retention_reminder_at TEXT").run();
  }
}

async function logVerificationActivity(env, clientId, auditId, eventType, eventLabel, details = "") {
  await ensureVerificationWorkspaceTables(env);
  await env.DB.prepare(`
    INSERT INTO client_verification_activity
      (client_id, audit_id, event_type, event_label, details, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    Number(clientId),
    Number(auditId) || null,
    String(eventType || "activity").slice(0,80),
    sanitizeVerificationActivity(eventLabel || "Verification activity").slice(0,200),
    sanitizeVerificationActivity(details || "").slice(0,2000)
  ).run();
}

async function clearSensitiveVerificationData(env, clientId) {
  await ensureVerificationWorkspaceTables(env);
  await env.DB.prepare("DELETE FROM client_verification_sensitive_fields WHERE client_id=?").bind(clientId).run();
  await env.DB.prepare("UPDATE client_verification_drafts SET birthdate='', persona_fields_json='{}', updated_at=CURRENT_TIMESTAMP WHERE client_id=?").bind(clientId).run();
  await env.DB.prepare(`
    UPDATE client_verification_audits
    SET submitted_employer='',submitted_job_title='',submitted_industry='',
        evidence_notes='',decision_notes='',birthdate='',updated_at=CURRENT_TIMESTAMP
    WHERE client_id=?
  `).bind(clientId).run();
}
async function clearSavedVerificationIdNumber(env, clientId) {
  await ensureVerificationWorkspaceTables(env);
  await env.DB.prepare(`
    UPDATE client_verification_sensitive_fields
    SET encrypted_id_number='',id_last4='',updated_at=CURRENT_TIMESTAMP
    WHERE client_id=?
  `).bind(clientId).run();
}
async function runVerificationRetention(env) {
  await ensureVerificationWorkspaceTables(env);
  const today=idDocumentToday();
  const due=await env.DB.prepare(`
    SELECT client_id,id_policy,id_delete_at,id_auto_delete,sensitive_policy,sensitive_delete_at,sensitive_auto_delete
    FROM client_verification_retention
    WHERE (id_auto_delete=1 AND id_policy<>'' AND id_delete_at<>'' AND id_delete_at<=?)
       OR (sensitive_auto_delete=1 AND sensitive_policy<>'' AND sensitive_delete_at<>'' AND sensitive_delete_at<=?)
    LIMIT 50
  `).bind(today,today).all();
  for(const row of (due.results||[])){
    const clientId=Number(row.client_id);
    if(Number(row.id_auto_delete)===1 && row.id_policy && row.id_delete_at && row.id_delete_at<=today){
      const doc=await env.DB.prepare("SELECT object_key FROM client_id_documents WHERE client_id=? LIMIT 1").bind(clientId).first();
      if(doc?.object_key && env.ID_DOCUMENTS) await env.ID_DOCUMENTS.delete(doc.object_key);
      await env.DB.prepare("DELETE FROM client_id_documents WHERE client_id=?").bind(clientId).run();
      await env.DB.prepare("UPDATE client_verification_retention SET id_auto_delete=0,id_delete_at='',updated_at=CURRENT_TIMESTAMP WHERE client_id=?").bind(clientId).run();
      await logVerificationActivity(env,clientId,null,"id_auto_deleted","ID document automatically deleted","Retention policy completed by system.");
    }
    if(Number(row.sensitive_auto_delete)===1 && row.sensitive_policy && row.sensitive_delete_at && row.sensitive_delete_at<=today){
      await clearSensitiveVerificationData(env,clientId);
      await env.DB.prepare("UPDATE client_verification_retention SET sensitive_auto_delete=0,sensitive_delete_at='',updated_at=CURRENT_TIMESTAMP WHERE client_id=?").bind(clientId).run();
      await logVerificationActivity(env,clientId,null,"sensitive_auto_deleted","Sensitive verification data automatically deleted","Retention policy completed by system.");
    }
  }
}

const US_STATE_CODES = {
  ALABAMA:"AL",ALASKA:"AK",ARIZONA:"AZ",ARKANSAS:"AR",CALIFORNIA:"CA",COLORADO:"CO",CONNECTICUT:"CT",
  DELAWARE:"DE",FLORIDA:"FL",GEORGIA:"GA",HAWAII:"HI",IDAHO:"ID",ILLINOIS:"IL",INDIANA:"IN",IOWA:"IA",
  KANSAS:"KS",KENTUCKY:"KY",LOUISIANA:"LA",MAINE:"ME",MARYLAND:"MD",MASSACHUSETTS:"MA",MICHIGAN:"MI",
  MINNESOTA:"MN",MISSISSIPPI:"MS",MISSOURI:"MO",MONTANA:"MT",NEBRASKA:"NE",NEVADA:"NV",NEW_HAMPSHIRE:"NH",
  NEW_JERSEY:"NJ",NEW_MEXICO:"NM",NEW_YORK:"NY",NORTH_CAROLINA:"NC",NORTH_DAKOTA:"ND",OHIO:"OH",
  OKLAHOMA:"OK",OREGON:"OR",PENNSYLVANIA:"PA",RHODE_ISLAND:"RI",SOUTH_CAROLINA:"SC",SOUTH_DAKOTA:"SD",
  TENNESSEE:"TN",TEXAS:"TX",UTAH:"UT",VERMONT:"VT",VIRGINIA:"VA",WASHINGTON:"WA",WEST_VIRGINIA:"WV",
  WISCONSIN:"WI",WYOMING:"WY",DISTRICT_OF_COLUMBIA:"DC"
};
const VALID_US_STATE_CODES = new Set(Object.values(US_STATE_CODES));
function normalizeVerificationState(value) {
  const raw=String(value||"").trim().replace(/\s+/g," ");
  if(!raw)return "";
  const upper=raw.toUpperCase();
  if(VALID_US_STATE_CODES.has(upper))return upper;
  return US_STATE_CODES[upper.replace(/[ .-]+/g,"_")] || upper;
}
function titleCaseVerificationAddress(value) {
  return String(value||"").trim().replace(/\s+/g," ").split(" ").map(word=>{
    if(/^\d+[A-Za-z]?$/.test(word)||/^#\w+$/i.test(word))return word.toUpperCase();
    const upper=word.toUpperCase();
    if(["NE","NW","SE","SW","N","S","E","W","PO","US"].includes(upper))return upper;
    return word.charAt(0).toUpperCase()+word.slice(1).toLowerCase();
  }).join(" ");
}
function normalizeVerificationAddressFields(fields) {
  const out={...fields};
  let line1=String(out.address_street_1||"").trim().replace(/\s+/g," ");
  let line2=String(out.address_street_2||"").trim().replace(/\s+/g," ");
  if(!line2&&line1){
    let match=line1.match(/^(.*?)[,\s]+(?:APT|APARTMENT|UNIT|SUITE|STE|#)\s*([A-Z0-9-]+)$/i);
    if(!match) {
      match=line1.match(/^(.*\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|WAY|PL|PLACE|PKWY|PARKWAY)(?:\s+(?:N|S|E|W|NE|NW|SE|SW))?)\s+(\d{1,6}[A-Z]?)$/i);
    }
    if(match){
      const possibleBase=match[1].trim().replace(/[, ]+$/,"");
      const unit=match[2].trim();
      const baseHasHouseNumber=/^\d+\s+/.test(possibleBase);
      const unitLooksLikeZip=/^\d{5}(?:-\d{4})?$/.test(unit);
      if(baseHasHouseNumber&&!unitLooksLikeZip){line1=possibleBase;line2="Unit "+unit;}
    }
  }
  out.address_street_1=titleCaseVerificationAddress(line1);
  out.address_street_2=titleCaseVerificationAddress(line2);
  out.address_city=titleCaseVerificationAddress(out.address_city||"");
  out.address_country_code=String(out.address_country_code||"US").trim().toUpperCase();
  out.address_subdivision=out.address_country_code==="US"
    ? normalizeVerificationState(out.address_subdivision||"")
    : String(out.address_subdivision||"").trim().replace(/\s+/g," ");
  out.address_postal_code=String(out.address_postal_code||"").trim().replace(/\s+/g,"");
  return out;
}
function normalizeVerificationPhone(value) {
  const digits=String(value||"").replace(/\D/g,"");
  if(digits.length===10)return "+1"+digits;
  if(digits.length===11&&digits.startsWith("1"))return "+"+digits;
  return String(value||"").trim();
}
function verificationEmailValid(value) {
  const email=String(value||"").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function verificationBase64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function verificationBytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function verificationEncryptionKey(env) {
  const encoded = String(env.VERIFICATION_FIELD_ENCRYPTION_KEY || "").trim();
  if (!encoded) throw new Error("VERIFICATION_FIELD_ENCRYPTION_KEY is not configured.");
  let bytes;
  try { bytes = verificationBase64ToBytes(encoded); } catch { throw new Error("VERIFICATION_FIELD_ENCRYPTION_KEY is not valid Base64."); }
  if (bytes.length !== 32) throw new Error("VERIFICATION_FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}
async function encryptVerificationField(env, value) {
  const plain = String(value || "").trim();
  if (!plain) return "";
  const key = await verificationEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, new TextEncoder().encode(plain));
  return "v1." + verificationBytesToBase64(iv) + "." + verificationBytesToBase64(new Uint8Array(encrypted));
}
async function decryptVerificationField(env, value) {
  const stored = String(value || "");
  if (!stored) return "";
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Stored verification field uses an unsupported encryption format.");
  const key = await verificationEncryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:verificationBase64ToBytes(parts[1])},
    key,
    verificationBase64ToBytes(parts[2])
  );
  return new TextDecoder().decode(decrypted);
}
function safeVerificationSensitiveRecord(row) {
  if (!row) return {has_id_number:false,id_number_masked:"",id_class:"",issuing_state:"",expiration_date:""};
  const last4=String(row.id_last4 || "");
  return {
    has_id_number:Boolean(row.encrypted_id_number),
    id_number_masked:last4 ? "••••" + last4 : (row.encrypted_id_number ? "Saved securely" : ""),
    id_class:row.id_class || "",
    issuing_state:row.issuing_state || "",
    expiration_date:row.expiration_date || ""
  };
}

const PERSONA_ID_NUMBER_FIELD_CANDIDATES = ["identification_number","id_number","license_number","document_number","government_id_number"];
const PERSONA_ID_CLASS_FIELD_CANDIDATES = ["identification_class","id_class","document_class"];
const PERSONA_ISSUING_STATE_FIELD_CANDIDATES = ["issuing_state","identification_subdivision","document_issuing_state"];
const PERSONA_EXPIRATION_FIELD_CANDIDATES = ["expiration_date","identification_expiration_date","document_expiration_date"];
function firstSupportedPersonaField(supported, candidates) {
  return candidates.find(key => supported.has(key)) || "";
}
function normalizePersonaConfigValue(value) {
  let raw=String(value || "").trim();
  if (raw.length >= 2) {
    const first=raw[0], last=raw[raw.length-1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) raw=raw.slice(1,-1).trim();
  }
  // Accept a clean secret value, or recover the ID if a full dashboard URL,
  // KEY=value string, or copied label was pasted into Cloudflare.
  const templateMatch=raw.match(/\bitmpl_[A-Za-z0-9]+\b/);
  if(templateMatch)return templateMatch[0];
  const apiKeyMatch=raw.match(/\bpersona_(?:sandbox|production)_[A-Za-z0-9_-]+\b/i);
  if(apiKeyMatch)return apiKeyMatch[0];
  const equalsIndex=raw.indexOf("=");
  if(equalsIndex>=0)raw=raw.slice(equalsIndex+1).trim().replace(/^["']|["']$/g,"");
  return raw;
}
async function fetchPersonaInquiryTemplateConfig(env) {
  const apiKey=normalizePersonaConfigValue(env.PERSONA_API_KEY);
  const inquiryTemplateId=normalizePersonaConfigValue(env.PERSONA_INQUIRY_TEMPLATE_ID);
  if (!apiKey) return {
    ok:false,state:"invalid_credentials",message:"Invalid credentials",
    api_key_status:"invalid",inquiry_template_status:"not_checked",
    technical_details:"PERSONA_API_KEY is missing."
  };
  const headers={Authorization:"Bearer "+apiKey,"Key-Inflection":"snake"};
  if (env.PERSONA_API_VERSION) headers["Persona-Version"]=String(env.PERSONA_API_VERSION);
  const configuredSupported=String(env.PERSONA_SUPPORTED_FIELDS || "").split(",").map(value=>value.trim()).filter(Boolean);
  const configuredRequired=String(env.PERSONA_REQUIRED_FIELDS || "").split(",").map(value=>value.trim()).filter(Boolean);
  const defaultSupported=[
    "name_first","name_middle","name_last","birthdate","address_street_1","address_street_2",
    "address_city","address_subdivision","address_postal_code","address_country_code",
    "email_address","phone_number"
  ];
  const buildConfig=(data,{state="connected",message="Connected",sandbox=false,effectiveTemplateId=inquiryTemplateId,templateSource="configured",technicalDetails=""}={})=>{
    const schemas=Array.isArray(data?.data?.attributes?.field_schemas) ? data.data.attributes.field_schemas : [];
    const supportedFields=schemas.length
      ? schemas.map(item=>String(item?.key || "").trim()).filter(Boolean)
      : (configuredSupported.length ? configuredSupported : defaultSupported);
    const requiredFields=configuredRequired.length
      ? configuredRequired
      : (schemas.length
        ? schemas.filter(item=>Boolean(item?.config?.required)).map(item=>String(item?.key || "").trim()).filter(Boolean)
        : ["name_first","name_last","birthdate"]);
    const supported=new Set(supportedFields);
    const idNumberField=firstSupportedPersonaField(supported,PERSONA_ID_NUMBER_FIELD_CANDIDATES);
    return {
      ok:true,state,message,sandbox,
      api_key_status:"connected",
      inquiry_template_status:(sandbox || state==="connected_template_unvalidated") ? "not_validated" : "connected",
      inquiry_template_id:effectiveTemplateId,
      inquiry_template_name:String(data?.data?.attributes?.name || ""),
      inquiry_template_source:templateSource,
      supported_fields:supportedFields,
      required_fields:requiredFields,
      id_number_supported:Boolean(idNumberField),
      id_number_field:idNumberField,
      technical_details:technicalDetails || (sandbox ? "Persona does not expose Inquiry Template resources through its Sandbox API. The API key is valid; the template will be validated when the first Sandbox inquiry is created." : "")
    };
  };
  // Validate the API key independently first. This prevents a template permission
  // problem from being mislabeled as bad credentials.
  const authResponse=await fetch("https://api.withpersona.com/api/v1/inquiries?page%5Bsize%5D=1",{headers});
  const authData=await authResponse.json().catch(()=>({}));
  const authRequestId=authResponse.headers.get("Request-Id") || "";
  if (!authResponse.ok) {
    const detail=String(authData?.errors?.[0]?.detail || authData?.errors?.[0]?.title || authData?.message || "");
    if (authResponse.status===401 || authResponse.status===403) {
      return {
        ok:false,state:"invalid_credentials",message:"Invalid credentials",
        api_key_status:"invalid",inquiry_template_status:"not_checked",
        technical_details:(detail || "Persona rejected the API key.")+(authRequestId ? " Persona request: "+authRequestId+"." : "")
      };
    }
    return {
      ok:false,state:"connection_error",message:"Persona connection error",
      api_key_status:"unknown",inquiry_template_status:"not_checked",
      technical_details:(detail || ("Persona returned HTTP "+authResponse.status+" while validating the API key."))+(authRequestId ? " Persona request: "+authRequestId+"." : "")
    };
  }

  const discoverPersonaInquiryTemplates=async()=>{
    const listResponse=await fetch("https://api.withpersona.com/api/v1/inquiry-templates?page%5Bsize%5D=100",{headers});
    const listData=await listResponse.json().catch(()=>({}));
    if(!listResponse.ok)return {ok:false,status:listResponse.status,data:listData,templates:[]};
    const templates=Array.isArray(listData?.data)?listData.data:[];
    return {ok:true,status:listResponse.status,data:listData,templates};
  };
  const chooseSingleActiveTemplate=async(reason)=>{
    const discovery=await discoverPersonaInquiryTemplates();
    if(!discovery.ok)return null;
    const active=discovery.templates.filter(item=>String(item?.attributes?.status||"").toLowerCase()==="active");
    if(active.length!==1)return {
      ok:false,
      active_count:active.length,
      options:active.slice(0,10).map(item=>({
        id:String(item?.id||""),
        name:String(item?.attributes?.name||"")
      }))
    };
    const selected=active[0];
    const selectedId=String(selected?.id||"");
    if(!/^itmpl_[A-Za-z0-9]+$/.test(selectedId))return null;
    const selectedResponse=await fetch("https://api.withpersona.com/api/v1/inquiry-templates/"+encodeURIComponent(selectedId),{headers});
    const selectedData=await selectedResponse.json().catch(()=>({}));
    if(!selectedResponse.ok)return null;
    return {
      ok:true,
      id:selectedId,
      data:selectedData,
      name:String(selected?.attributes?.name||selectedData?.data?.attributes?.name||""),
      reason
    };
  };

  // The API key is valid. Validate the configured Inquiry Template separately
  // so the dashboard can report the two connection states independently.
  if (!inquiryTemplateId || !/^itmpl_[A-Za-z0-9]+$/.test(inquiryTemplateId)) {
    const discovered=await chooseSingleActiveTemplate(!inquiryTemplateId ? "missing_config" : "invalid_config");
    if(discovered?.ok){
      return buildConfig(discovered.data,{
        state:"connected",
        message:"Connected",
        effectiveTemplateId:discovered.id,
        templateSource:"auto_discovered",
        technicalDetails:"The configured Inquiry Template was not usable. ClearPath found the only active Persona Inquiry Template and will use it automatically: "+(discovered.name||discovered.id)+". Update PERSONA_INQUIRY_TEMPLATE_ID in Cloudflare to "+discovered.id+" to make the configuration explicit."
      });
    }
    const options=discovered?.options||[];
    const optionText=options.length ? " Active templates: "+options.map(item=>(item.name?item.name+" ":"")+item.id).join(", ")+".":"";
    const detectedPrefix=!inquiryTemplateId ? "" :
      inquiryTemplateId.startsWith("txntp_") ? "txntp_" :
      inquiryTemplateId.startsWith("inq_") ? "inq_" :
      inquiryTemplateId.startsWith("tmpl_") ? "tmpl_" :
      inquiryTemplateId.includes("_") ? inquiryTemplateId.slice(0,inquiryTemplateId.indexOf("_")+1) :
      inquiryTemplateId.slice(0,Math.min(8,inquiryTemplateId.length));
    return {
      ok:false,state:"incorrect_inquiry_template",message:"Incorrect Inquiry Template",
      api_key_status:"connected",
      inquiry_template_status:!inquiryTemplateId?"missing":"invalid_format",
      template_id_format_valid:false,
      detected_template_prefix:detectedPrefix,
      technical_details:(!inquiryTemplateId
        ? "PERSONA_INQUIRY_TEMPLATE_ID is missing."
        : "The saved PERSONA_INQUIRY_TEMPLATE_ID is not an Inquiry Template ID. Detected prefix: "+(detectedPrefix||"unknown")+". Replace its Cloudflare secret value with the Persona Inquiry Template ID beginning with itmpl_. Do not use a txntp_ Transaction Type ID or an inq_ Inquiry ID.")+
        (discovered&&discovered.active_count!==undefined ? " Persona has "+discovered.active_count+" active Inquiry Template"+(discovered.active_count===1?"":"s")+".":"")+
        optionText
    };
  }

  // Persona intentionally does not expose Inquiry Template resources through
  // the Sandbox API. For Sandbox, a valid key + a syntactically valid itmpl_
  // value is the strongest non-destructive connection test available.
  if (/^persona_sandbox_/i.test(apiKey)) {
    return buildConfig({}, {state:"connected_sandbox",message:"Connected (Sandbox)",sandbox:true});
  }

  const response=await fetch("https://api.withpersona.com/api/v1/inquiry-templates/"+encodeURIComponent(inquiryTemplateId),{headers});
  const data=await response.json().catch(()=>({}));
  const templateRequestId=response.headers.get("Request-Id") || "";
  if (!response.ok) {
    const detail=String(data?.errors?.[0]?.detail || data?.errors?.[0]?.title || data?.message || "");
    if (response.status===403) {
      return buildConfig({},{
        state:"connected_template_unvalidated",
        message:"Connected",
        effectiveTemplateId:inquiryTemplateId,
        templateSource:"configured_unvalidated",
        technicalDetails:(detail || "The API key is valid, but it does not have Inquiry Template read permission. ClearPath will use the configured itmpl_ ID when creating the inquiry; Persona will validate it at submission time.")+
          (templateRequestId ? " Persona request: "+templateRequestId+"." : "")
      });
    }
    if (response.status===404 || response.status===400) {
      // A valid API key can still be unable to read Inquiry Template metadata on some
      // Persona plans/configurations. Do not mark the configured itmpl_ as rejected
      // based only on the template-read endpoint. The authoritative validation happens
      // when Persona accepts or rejects the inquiry creation request.
      return buildConfig({},{
        state:"connected_template_unvalidated",
        message:"Connected",
        effectiveTemplateId:inquiryTemplateId,
        templateSource:"configured_unvalidated",
        technicalDetails:(detail || "The API key is valid, but Persona did not validate the Inquiry Template through the metadata endpoint. ClearPath will use the configured itmpl_ ID when creating the inquiry; Persona will validate it at submission time.")+
          (templateRequestId ? " Persona request: "+templateRequestId+"." : "")
      });
    }
    if (response.status===401) {
      return {
        ok:false,state:"invalid_credentials",message:"Invalid credentials",
        api_key_status:"invalid",inquiry_template_status:"not_checked",
        technical_details:(detail || "Persona rejected the API key.")+(templateRequestId ? " Persona request: "+templateRequestId+"." : "")
      };
    }
    return {
      ok:false,state:"connection_error",message:"Persona connection error",
      api_key_status:"connected",inquiry_template_status:"unknown",
      technical_details:(detail || ("Persona returned HTTP "+response.status+" while validating the Inquiry Template."))+(templateRequestId ? " Persona request: "+templateRequestId+"." : "")
    };
  }
  return buildConfig(data);
}

function safeVerificationDraft(row) {
  let personaFields = {};
  try { personaFields = JSON.parse(row?.persona_fields_json || "{}"); } catch {}
  return {
    client_id:Number(row?.client_id || 0),
    birthdate:row?.birthdate || "",
    persona_fields:personaFields && typeof personaFields === "object" ? personaFields : {},
    updated_at:row?.updated_at || ""
  };
}

function verificationAgeOnDate(birthdate, now = new Date()) {
  const match = String(birthdate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let age = now.getUTCFullYear() - year;
  const beforeBirthday = (now.getUTCMonth() + 1 < month) || ((now.getUTCMonth() + 1 === month) && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

async function ensureClientIdDocumentsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS client_id_documents (
      client_id INTEGER PRIMARY KEY,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'pending_review',
      received_at TEXT NOT NULL,
      verified_at TEXT,
      retention_reminder_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  const columnRows = await env.DB.prepare("PRAGMA table_info(client_id_documents)").all();
  const columns = new Set((columnRows.results || []).map(row => String(row.name || "")));
  if (!columns.has("retention_reminder_at")) {
    await env.DB.prepare("ALTER TABLE client_id_documents ADD COLUMN retention_reminder_at TEXT").run();
  }
}

function idDocumentDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function idDocumentToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function idDocumentPublicRecord(row) {
  if (!row) return null;
  return {
    client_id: Number(row.client_id),
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size: Number(row.file_size || 0),
    verification_status: row.verification_status || "pending_review",
    received_at: row.received_at || "",
    verified_at: row.verified_at || "",
    retention_reminder_at: row.retention_reminder_at || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

async function requireIdDocumentClient(env, clientId) {
  if (!Number.isInteger(clientId) || clientId < 1) return null;
  return env.DB.prepare("SELECT id FROM clients WHERE id = ? LIMIT 1").bind(clientId).first();
}

function normalizeSiteRates(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8) return null;
  const normalized = value.map(service => {
    const name = String(service?.name || "").trim().slice(0, 120);
    const description = String(service?.description || "").trim().slice(0, 4000);
    const rates = Array.isArray(service?.rates)
      ? service.rates.slice(0, 12).map(rate => [
          String(rate?.[0] || "").trim().slice(0, 60),
          Number(rate?.[1])
        ])
      : [];
    return { name, description, rates, add_on: Boolean(service?.add_on) };
  });
  if (normalized.some(service =>
    !service.name ||
    !service.description ||
    !service.rates.length ||
    service.rates.some(rate => !rate[0] || !Number.isFinite(rate[1]) || rate[1] <= 0)
  )) return null;
  return normalized;
}

async function readSiteRates(env) {
  await ensureSiteContentTables(env);
  const rows = await env.DB.prepare(
    "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('rate_services', 'rate_services_version')"
  ).all();
  const settings = Object.fromEntries((rows.results || []).map(row => [row.setting_key, row.setting_value]));
  if (settings.rate_services_version !== DEFAULT_SITE_RATES_VERSION) {
    const updatedRates = structuredClone(DEFAULT_SITE_RATES);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO site_settings (setting_key, setting_value, updated_at)
        VALUES ('rate_services', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `).bind(JSON.stringify(updatedRates)),
      env.DB.prepare(`
        INSERT INTO site_settings (setting_key, setting_value, updated_at)
        VALUES ('rate_services_version', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
      `).bind(DEFAULT_SITE_RATES_VERSION)
    ]);
    return updatedRates;
  }
  const row = { setting_value: settings.rate_services };
  if (!row?.setting_value) return structuredClone(DEFAULT_SITE_RATES);
  try {
    return normalizeSiteRates(JSON.parse(row.setting_value)) || structuredClone(DEFAULT_SITE_RATES);
  } catch {
    return structuredClone(DEFAULT_SITE_RATES);
  }
}

function siteMinutesFromTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function siteDurationMinutes(value) {
  const normalized = String(value || "").toLowerCase().replace(/(\d)½/g, "$1.5");
  const minuteMatch = normalized.match(/(\d+)\s*(?:minute|min)/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const minuteSlug = normalized.match(/^(\d+)-minutes?$/);
  if (minuteSlug) return Number(minuteSlug[1]);
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)/);
  if (match) return Math.round(Number(match[1]) * 60);
  const slug = normalized.match(/^(\d+(?:\.\d+)?)-hours?$/);
  return slug ? Math.round(Number(slug[1]) * 60) : 60;
}

function siteBookingDurationFromNotes(notes) {
  const match = String(notes || "").match(/Duration:\s*([^\n]+)/i);
  return siteDurationMinutes(match?.[1] || "1 hour");
}

function siteZonedDateTime(dateValue, timeValue) {
  const dateMatch = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue || "").match(/^(\d{1,2}):(\d{2})/);
  if (!dateMatch || !timeMatch) return new Date(NaN);
  const parts = [
    Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2])
  ];
  const guess = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const zoned = Object.fromEntries(
    formatter.formatToParts(new Date(guess))
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  );
  const represented = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute);
  return new Date(guess - (represented - guess));
}

async function siteAvailableSlots(env, date, requestedDuration, excludeRequestId = null) {
  await ensureSiteContentTables(env);
  const requestedDate = new Date(String(date) + "T12:00:00");
  if (!Number.isFinite(requestedDate.getTime())) {
    return { slots: [], availability_state: "not_configured" };
  }
  const dayOfWeek = requestedDate.getDay();
  const [workHours, bookedResult] = await Promise.all([
    env.DB.prepare(
      "SELECT enabled, start_time, end_time FROM calendar_work_hours WHERE day_of_week = ? LIMIT 1"
    ).bind(dayOfWeek).first(),
    env.DB.prepare(`
      SELECT requested_date, requested_time, notes
      FROM date_requests
      WHERE requested_date = ?
        AND final_approval = 1
        AND status NOT IN ('canceled', 'declined', 'blacklisted_submission', 'no_call_no_show', 'completed')
        AND (? IS NULL OR id != ?)
    `).bind(date, excludeRequestId, excludeRequestId).all()
  ]);

  if (!workHours || !Number(workHours.enabled)) {
    return { slots: [], availability_state: "not_configured" };
  }

  const workStart = siteMinutesFromTime(workHours.start_time);
  const workEnd = siteMinutesFromTime(workHours.end_time);
  if (workStart === null || workEnd === null || workEnd <= workStart) {
    return { slots: [], availability_state: "not_configured" };
  }

  const durationMinutes = Math.max(20, Number(requestedDuration) || 60);
  // Keep a 30-minute buffer after the work day begins and before it ends.
  // This also guarantees the requested experience can finish before the closing buffer.
  const bookableWorkStart = workStart + 30;
  const bookableWorkEnd = workEnd - 30;
  const candidateTimes = [];
  for (let minute = bookableWorkStart; minute + durationMinutes <= bookableWorkEnd; minute += 30) {
    candidateTimes.push(
      String(Math.floor(minute / 60)).padStart(2, "0") + ":" +
      String(minute % 60).padStart(2, "0")
    );
  }

  const bookings = (bookedResult.results || []).map(item => {
    const start = siteZonedDateTime(item.requested_date, item.requested_time).getTime();
    return {
      start,
      end: start + siteBookingDurationFromNotes(item.notes) * 60 * 1000
    };
  }).filter(item => Number.isFinite(item.start));

  const earliest = Date.now() + 2 * 60 * 60 * 1000;
  const bookableCandidates = candidateTimes.filter(time => {
    const start = siteZonedDateTime(date, time).getTime();
    return Number.isFinite(start) && start >= earliest;
  });
  const slots = bookableCandidates.filter(time => {
    const start = siteZonedDateTime(date, time).getTime();
    const end = start + durationMinutes * 60 * 1000;
    // Reserve a 30-minute reset/travel buffer after every confirmed appointment.
    return !bookings.some(booking => start < (booking.end + 30 * 60 * 1000) && end > booking.start);
  });

  return {
    slots,
    availability_state: slots.length
      ? "available"
      : bookableCandidates.length
        ? "fully_booked"
        : "outside_booking_window"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const verificationAccess=verificationRouteAccess(url.pathname,request.method);
    if(verificationAccess){
      const authorization=authorizeVerificationRequest(request,env,verificationAccess.permission,{fresh:verificationAccess.fresh});
      if(!authorization.ok)return verificationForbidden(authorization);
    }


    // =========================================================
    // PRIVATE CLIENT VERIFICATION AUDIT
    // Protected by Cloudflare Access with the rest of /api/admin.
    // =========================================================

    if (url.pathname === "/api/admin/clients/verification-draft" && request.method === "GET") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) return Response.json({ok:false,message:"Client not found."},{status:404});
        const row = await env.DB.prepare(
          "SELECT client_id, birthdate, persona_fields_json, updated_at FROM client_verification_drafts WHERE client_id=? LIMIT 1"
        ).bind(clientId).first();
        const sensitive = await env.DB.prepare(
          "SELECT encrypted_id_number, id_last4, id_class, issuing_state, expiration_date FROM client_verification_sensitive_fields WHERE client_id=? LIMIT 1"
        ).bind(clientId).first();
        const draft=row ? safeVerificationDraft(row) : {client_id:clientId,birthdate:"",persona_fields:{},updated_at:""};
        draft.id_details=safeVerificationSensitiveRecord(sensitive);
        return Response.json({ok:true,draft}, {headers:{"Cache-Control":"private, no-store"}});
      } catch (error) {
        console.error("Verification draft load error:", error);
        return Response.json({ok:false,message:"Unable to load saved verification information."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-draft" && request.method === "POST") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const data = await request.json().catch(() => ({}));
        const clientId = Number(data.client_id);
        if (!await requireIdDocumentClient(env, clientId)) return Response.json({ok:false,message:"Client not found."},{status:404});
        const birthdate = idDocumentDate(data.birthdate);
        const incoming = data.persona_fields && typeof data.persona_fields === "object" ? data.persona_fields : {};
        const allowed = new Set(["name_first","name_middle","name_last","address_street_1","address_street_2","address_city","address_subdivision","address_postal_code","address_country_code","email_address","phone_number"]);
        let normalized = {};
        for (const [key, raw] of Object.entries(incoming)) {
          if (!allowed.has(key)) continue;
          let value = String(raw || "").trim().replace(/\s+/g," ");
          if (key === "email_address") value = value.toLowerCase().replace(/\s+/g,"").replace(/[;,]+$/,"");
          if (key === "phone_number") value = normalizeVerificationPhone(value);
          if (value) normalized[key] = value;
        }
        normalized = normalizeVerificationAddressFields(normalized);
        const idDetails = data.id_details && typeof data.id_details === "object" ? data.id_details : {};
        const enteredIdNumber = String(idDetails.id_number || "").trim().replace(/\s+/g," ").slice(0,80);
        const issuingState = normalizeVerificationState(idDetails.issuing_state || "").slice(0,40);
        const expirationDate = idDocumentDate(idDetails.expiration_date);
        const idClass = ["dl","id"].includes(String(idDetails.id_class || "").toLowerCase()) ? String(idDetails.id_class).toLowerCase() : "";
        const existingSensitive = await env.DB.prepare(
          "SELECT encrypted_id_number, id_last4 FROM client_verification_sensitive_fields WHERE client_id=? LIMIT 1"
        ).bind(clientId).first();
        let encryptedIdNumber=String(existingSensitive?.encrypted_id_number || "");
        let idLast4=String(existingSensitive?.id_last4 || "");
        if (enteredIdNumber) {
          encryptedIdNumber=await encryptVerificationField(env,enteredIdNumber);
          idLast4=enteredIdNumber.replace(/[^A-Za-z0-9]/g,"").slice(-4);
        }
        if (data.clear_id_number === true) { encryptedIdNumber=""; idLast4=""; }
        if (encryptedIdNumber || idClass || issuingState || expirationDate) {
          await env.DB.prepare(`
            INSERT INTO client_verification_sensitive_fields
              (client_id, encrypted_id_number, id_last4, id_class, issuing_state, expiration_date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(client_id) DO UPDATE SET
              encrypted_id_number=excluded.encrypted_id_number,
              id_last4=excluded.id_last4,
              id_class=excluded.id_class,
              issuing_state=excluded.issuing_state,
              expiration_date=excluded.expiration_date,
              updated_at=CURRENT_TIMESTAMP
          `).bind(clientId, encryptedIdNumber, idLast4, idClass, issuingState, expirationDate).run();
        }
        await env.DB.prepare(`
          INSERT INTO client_verification_drafts (client_id, birthdate, persona_fields_json, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(client_id) DO UPDATE SET
            birthdate=excluded.birthdate,
            persona_fields_json=excluded.persona_fields_json,
            updated_at=CURRENT_TIMESTAMP
        `).bind(clientId, birthdate, JSON.stringify(normalized)).run();
        const row = await env.DB.prepare(
          "SELECT client_id, birthdate, persona_fields_json, updated_at FROM client_verification_drafts WHERE client_id=?"
        ).bind(clientId).first();
        const sensitive = await env.DB.prepare(
          "SELECT encrypted_id_number, id_last4, id_class, issuing_state, expiration_date FROM client_verification_sensitive_fields WHERE client_id=? LIMIT 1"
        ).bind(clientId).first();
        const draft=safeVerificationDraft(row);
        draft.id_details=safeVerificationSensitiveRecord(sensitive);
        return Response.json({ok:true,draft}, {headers:{"Cache-Control":"private, no-store"}});
      } catch (error) {
        console.error("Verification draft save error:", error);
        return Response.json({ok:false,message:"Unable to save verification information."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-activity" && request.method === "GET") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) return Response.json({ok:false,message:"Client not found."},{status:404});
        const rows = await env.DB.prepare(`
          SELECT id, client_id, audit_id, event_type, event_label, details, created_at
          FROM client_verification_activity
          WHERE client_id=?
          ORDER BY created_at DESC, id DESC
          LIMIT 200
        `).bind(clientId).all();
        return Response.json({ok:true,activity:rows.results || []}, {headers:{"Cache-Control":"private, no-store"}});
      } catch (error) {
        console.error("Verification activity load error:", error);
        return Response.json({ok:false,message:"Unable to load verification activity."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/id-document/retention" && request.method === "GET") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const clientId=Number(url.searchParams.get("client_id"));
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});
        const row=await env.DB.prepare("SELECT * FROM client_verification_retention WHERE client_id=? LIMIT 1").bind(clientId).first();
        return Response.json({ok:true,retention:row||{client_id:clientId,id_policy:"",id_delete_at:"",id_auto_delete:0,sensitive_policy:"",sensitive_delete_at:"",sensitive_auto_delete:0,updated_by:"",updated_at:""}},{headers:{"Cache-Control":"private, no-store"}});
      }catch(error){
        console.error("Verification retention load error:",error);
        return Response.json({ok:false,message:"Unable to load retention settings."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/id-document/retention" && request.method === "POST") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const data=await request.json().catch(()=>({}));
        const clientId=Number(data.client_id);
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});
        const target=data.target==="sensitive"?"sensitive":"id";
        const policy=String(data.policy||"").trim().slice(0,80);
        const deleteAt=retentionDate(data.scheduled_delete_at);
        const autoDelete=Boolean(data.auto_delete);
        if(autoDelete && (!policy || !deleteAt)){
          return Response.json({ok:false,message:"Choose an explicit retention policy and scheduled deletion date before enabling automatic deletion."},{status:400});
        }
        const current=await env.DB.prepare("SELECT * FROM client_verification_retention WHERE client_id=? LIMIT 1").bind(clientId).first()||{};
        const actor=accessIdentity(request).email||"authorized-admin";
        const next={
          id_policy:String(current.id_policy||""),id_delete_at:String(current.id_delete_at||""),id_auto_delete:Number(current.id_auto_delete||0),
          sensitive_policy:String(current.sensitive_policy||""),sensitive_delete_at:String(current.sensitive_delete_at||""),sensitive_auto_delete:Number(current.sensitive_auto_delete||0)
        };
        if(target==="id"){next.id_policy=policy;next.id_delete_at=deleteAt;next.id_auto_delete=autoDelete?1:0;}
        else{next.sensitive_policy=policy;next.sensitive_delete_at=deleteAt;next.sensitive_auto_delete=autoDelete?1:0;}
        await env.DB.prepare(`
          INSERT INTO client_verification_retention
            (client_id,id_policy,id_delete_at,id_auto_delete,sensitive_policy,sensitive_delete_at,sensitive_auto_delete,updated_by,updated_at)
          VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(client_id) DO UPDATE SET
            id_policy=excluded.id_policy,id_delete_at=excluded.id_delete_at,id_auto_delete=excluded.id_auto_delete,
            sensitive_policy=excluded.sensitive_policy,sensitive_delete_at=excluded.sensitive_delete_at,sensitive_auto_delete=excluded.sensitive_auto_delete,
            updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
        `).bind(clientId,next.id_policy,next.id_delete_at,next.id_auto_delete,next.sensitive_policy,next.sensitive_delete_at,next.sensitive_auto_delete,actor).run();
        await logVerificationActivity(env,clientId,null,"retention_scheduled",
          target==="id"?"ID retention policy changed":"Sensitive-data retention policy changed",
          "Deletion schedule "+(deleteAt||"cleared")+" · Automatic deletion "+(autoDelete?"enabled":"disabled")+" · Changed by "+actor);
        const row=await env.DB.prepare("SELECT * FROM client_verification_retention WHERE client_id=? LIMIT 1").bind(clientId).first();
        return Response.json({ok:true,retention:row},{headers:{"Cache-Control":"private, no-store"}});
      }catch(error){
        console.error("Verification retention update error:",error);
        return Response.json({ok:false,message:"Unable to update retention settings."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-sensitive" && request.method === "DELETE") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const data=await request.json().catch(()=>({}));
        const clientId=Number(data.client_id||url.searchParams.get("client_id"));
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});
        await clearSensitiveVerificationData(env,clientId);
        await env.DB.prepare("UPDATE client_verification_retention SET sensitive_auto_delete=0,sensitive_delete_at='',updated_at=CURRENT_TIMESTAMP WHERE client_id=?").bind(clientId).run();
        const actor=accessIdentity(request).email||"authorized-admin";
        await logVerificationActivity(env,clientId,null,"sensitive_deleted","Sensitive verification data deleted","Deleted by "+actor+". Non-sensitive verification audit history retained.");
        return Response.json({ok:true,deleted:true},{headers:{"Cache-Control":"private, no-store"}});
      }catch(error){
        console.error("Sensitive verification deletion error:",error);
        return Response.json({ok:false,message:"Unable to delete sensitive verification data."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-sensitive/id-number" && request.method === "DELETE") {
      try {
        const data=await request.json().catch(()=>({}));
        const clientId=Number(data.client_id||url.searchParams.get("client_id"));
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});
        await clearSavedVerificationIdNumber(env,clientId);
        const actor=accessIdentity(request).email||"authorized-admin";
        await logVerificationActivity(env,clientId,null,"id_number_deleted","Saved DL/State ID number deleted","Deleted by "+actor+". The prior full value was not retained in the audit log.");
        return Response.json({ok:true,deleted:true},{headers:{"Cache-Control":"private, no-store"}});
      }catch(error){
        console.error("Saved ID number deletion error:",error);
        return Response.json({ok:false,message:"Unable to delete the saved ID number."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-overview" && request.method === "GET") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const rows = await env.DB.prepare(`
          SELECT c.id AS client_id, c.first_name, c.last_name, c.email, c.phone,
                 COALESCE(a.date_request_id, 0) AS booking_request_id,
                 COALESCE(a.verification_status, 'pending_review') AS verification_status,
                 COALESCE(a.verification_method, '') AS verification_method,
                 COALESCE(a.persona_transaction_id, '') AS persona_transaction_id,
                 COALESCE(a.persona_transaction_status, '') AS persona_transaction_status,
                 COALESCE(a.persona_submitted_at, '') AS persona_submitted_at,
                 COALESCE(a.persona_updated_at, '') AS persona_updated_at,
                 COALESCE(a.completed_at, '') AS completed_at,
                 COALESCE(a.review_flag, 0) AS review_flag,
                 COALESCE((SELECT created_at FROM date_requests r WHERE r.id=a.date_request_id LIMIT 1),'') AS booking_request_created_at,
                 COALESCE(a.identity_confirmed,0)+COALESCE(a.employer_confirmed,0)+
                 COALESCE(a.job_title_confirmed,0)+COALESCE(a.industry_confirmed,0)+
                 COALESCE(a.contact_confirmed,0) AS checklist_count,
                 CASE WHEN d.client_id IS NULL THEN 0 ELSE 1 END AS has_id,
                 COALESCE(d.retention_reminder_at,'') AS retention_reminder_at
          FROM clients c
          LEFT JOIN client_id_documents d ON d.client_id = c.id
          LEFT JOIN client_verification_audits a ON a.id = (
            SELECT v.id FROM client_verification_audits v
            WHERE v.client_id = c.id
            ORDER BY v.accepted_at DESC, v.id DESC
            LIMIT 1
          )
        `).all();
        const clients=(rows.results || []).map(row => {
          const personaStatus=String(row.persona_transaction_status || "").toLowerCase();
          const personaPending=Boolean(row.persona_transaction_id) && !["approved","declined","errored","failed"].includes(personaStatus);
          const status=row.verification_status || "pending_review";
          const checklistCount=Number(row.checklist_count || 0);
          let queue_category="ready_for_final_decision";
          if (!Number(row.has_id || 0)) queue_category="needs_id";
          else if (status === "needs_more_information") queue_category="needs_more_information";
          else if (personaPending) queue_category="persona_pending";
          else if (checklistCount < 5) queue_category="checklist_incomplete";
          else if (status === "pending_review") queue_category="needs_manual_review";
          return {
            client_id:Number(row.client_id),
            first_name:row.first_name || "", last_name:row.last_name || "",
            email:row.email || "", phone:row.phone || "",
            booking_request_id:Number(row.booking_request_id || 0),
            verification_status:status,
            verification_method:row.verification_method || "",
            persona_transaction_id:row.persona_transaction_id || "",
            persona_transaction_status:row.persona_transaction_status || "",
            persona_submitted_at:row.persona_submitted_at || "",
            persona_updated_at:row.persona_updated_at || "",
            completed_at:row.completed_at || "",
            review_flag:Number(row.review_flag || 0)===1,
            booking_request_created_at:row.booking_request_created_at || "",
            checklist_count:checklistCount,
            has_id:Number(row.has_id || 0)===1,
            retention_reminder_at:row.retention_reminder_at || "",
            retention_due:Boolean(row.retention_reminder_at) && String(row.retention_reminder_at) <= new Date().toISOString().slice(0,10),
            persona_pending:personaPending,
            queue_category
          };
        });
        const counts={
          pending_review:clients.filter(x=>x.verification_status==="pending_review").length,
          verified:clients.filter(x=>x.verification_status==="verified").length,
          unable_to_verify:clients.filter(x=>x.verification_status==="unable_to_verify").length,
          declined:clients.filter(x=>x.verification_status==="declined").length,
          needs_more_information:clients.filter(x=>x.verification_status==="needs_more_information").length,
          persona_pending:clients.filter(x=>x.persona_pending).length,
          no_id:clients.filter(x=>!x.has_id).length,
          needs_id:clients.filter(x=>x.queue_category==="needs_id").length,
          checklist_incomplete:clients.filter(x=>x.queue_category==="checklist_incomplete").length,
          ready_for_final_decision:clients.filter(x=>x.queue_category==="ready_for_final_decision").length,
          retention_due:clients.filter(x=>x.retention_due).length
        };
        const order={needs_id:0,needs_more_information:1,checklist_incomplete:2,persona_pending:3,needs_manual_review:4,ready_for_final_decision:5};
        const queue=[...clients]
          .filter(x=>["pending_review","needs_more_information"].includes(x.verification_status) || x.persona_pending || x.review_flag)
          .sort((a,b)=>(order[a.queue_category]??9)-(order[b.queue_category]??9) || a.client_id-b.client_id);
        return Response.json({ok:true,clients,counts,queue}, {headers:{"Cache-Control":"private, no-store"}});
      } catch (error) {
        console.error("Verification overview error:", error);
        return Response.json({ok:false,message:"Unable to load verification overview."},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/verification-audit" && request.method === "GET") {
      try {
        await ensureClientVerificationAuditsTable(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) {
          return Response.json({ ok: false, message: "Client not found." }, { status: 404 });
        }
        const selectColumns = `
          id, client_id, date_request_id, accepted, authorization_wording,
          authorization_version, accepted_at, verification_status,
          verification_method, submitted_employer, submitted_job_title,
          submitted_industry, identity_confirmed, employer_confirmed,
          job_title_confirmed, industry_confirmed, contact_confirmed,
          evidence_notes, decision_reason, decision_notes, birthdate, completed_by, review_flag,
          persona_transaction_id, persona_transaction_status, persona_submitted_at, persona_updated_at, completed_at, updated_at
        `;
        let result = await env.DB.prepare(`
          SELECT ${selectColumns}
          FROM client_verification_audits
          WHERE client_id = ?
          ORDER BY accepted_at DESC, id DESC
        `).bind(clientId).all();
        if (!(result.results || []).length) {
          const latestRequest = await env.DB.prepare(
            "SELECT id FROM date_requests WHERE client_id=? ORDER BY created_at DESC, id DESC LIMIT 1"
          ).bind(clientId).first();
          const requestId = Number(latestRequest?.id || 0);
          if (requestId) {
            await env.DB.prepare(`
              INSERT INTO client_verification_audits
                (client_id, date_request_id, accepted, authorization_wording,
                 authorization_version, accepted_at, verification_status, verification_method)
              VALUES (?, ?, 0, 'Screening acknowledgement was not recorded for this legacy booking request.',
                      'legacy-unrecorded', CURRENT_TIMESTAMP, 'pending_review', 'Admin verification')
              ON CONFLICT(date_request_id) DO NOTHING
            `).bind(clientId, requestId).run();
            result = await env.DB.prepare(`
              SELECT ${selectColumns}
              FROM client_verification_audits
              WHERE client_id = ?
              ORDER BY accepted_at DESC, id DESC
            `).bind(clientId).all();
          }
        }
        const history = await env.DB.prepare(`
          SELECT id, audit_id, client_id, verification_status, decision_reason, decision_notes,
                 verification_method, completed_at, completed_by, changed_at
          FROM client_verification_decision_history
          WHERE client_id=?
          ORDER BY changed_at DESC, id DESC
        `).bind(clientId).all();
        const attempts=await env.DB.prepare(`
          SELECT id,client_id,audit_id,transaction_id,transaction_status,replaces_attempt_id,submitted_at,last_refreshed_at,updated_at
          FROM persona_verification_attempts WHERE client_id=? ORDER BY submitted_at DESC,id DESC LIMIT 50
        `).bind(clientId).all();
        return Response.json({
          ok: true,
          records: (result.results || []).map(verificationAuditPublicRecord),
          history: history.results || [],
          persona_attempts: attempts.results || []
        }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) {
        console.error("Load client verification audit error:", error);
        return Response.json({ ok: false, message: "Unable to load verification records." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/clients/verification-audit" && request.method === "POST") {
      try {
        await ensureClientVerificationAuditsTable(env);
        const data = await request.json().catch(() => ({}));
        const auditId = Number(data.audit_id);
        const clientId = Number(data.client_id);
        if (!Number.isInteger(auditId) || auditId < 1 || !await requireIdDocumentClient(env, clientId)) {
          return Response.json({ ok: false, message: "Verification record not found." }, { status: 404 });
        }
        const allowedStatuses = new Set(["pending_review", "needs_more_information", "verified", "unable_to_verify", "declined"]);
        const verificationStatus = String(data.verification_status || "");
        if (!allowedStatuses.has(verificationStatus)) {
          return Response.json({ ok: false, message: "Choose a valid final decision." }, { status: 400 });
        }

        const previous = await env.DB.prepare(`
          SELECT id, client_id, verification_status, decision_reason, decision_notes,
                 verification_method, completed_at, completed_by, review_flag, updated_at,
                 identity_confirmed, employer_confirmed, job_title_confirmed, industry_confirmed, contact_confirmed
          FROM client_verification_audits
          WHERE id=? AND client_id=? LIMIT 1
        `).bind(auditId, clientId).first();
        if (!previous) return Response.json({ok:false,message:"Verification record not found."},{status:404});
        const expectedUpdatedAt=String(data.expected_updated_at||"").trim();
        if(expectedUpdatedAt && String(previous.updated_at||"") !== expectedUpdatedAt){
          return Response.json({
            ok:false,
            code:"verification_record_changed",
            requires_reload:true,
            message:"This verification record was updated in another session. The latest version has been reloaded so your changes do not overwrite newer work.",
            current_updated_at:String(previous.updated_at||"")
          },{status:409,headers:{"Cache-Control":"private, no-store"}});
        }
        if (previous.verification_status !== "pending_review" && verificationStatus === "pending_review" && !data.confirm_reopen) {
          return Response.json({
            ok:false,
            requires_confirmation:true,
            message:"This verification is already completed. Confirm that you want to reopen it as Pending Review."
          }, {status:409});
        }

        const verificationMethod = String(data.verification_method || "").trim().slice(0, 240);
        const submittedIndustry = String(data.submitted_industry || "").trim().slice(0, 160);
        const identityConfirmed = data.identity_confirmed ? 1 : 0;
        const employerConfirmed = data.employer_confirmed ? 1 : 0;
        const jobTitleConfirmed = data.job_title_confirmed ? 1 : 0;
        const industryConfirmed = data.industry_confirmed ? 1 : 0;
        const contactConfirmed = data.contact_confirmed ? 1 : 0;
        const evidenceNotes = String(data.evidence_notes || "").trim().slice(0, 2000);
        const decisionReason = String(data.decision_reason || "").trim().slice(0, 160);
        const decisionNotes = String(data.decision_notes || "").trim().slice(0, 1200);
        const birthdate = idDocumentDate(data.birthdate);
        const age = verificationAgeOnDate(birthdate);

        if (verificationStatus === "verified") {
          if (!(identityConfirmed && employerConfirmed && jobTitleConfirmed && industryConfirmed && contactConfirmed)) {
            return Response.json({
              ok:false,
              message:"All five manual verification checklist items must be confirmed before marking this client Verified."
            }, {status:400});
          }
          if (age === null) {
            return Response.json({ok:false,message:"Enter a valid birthdate before marking this client Verified."},{status:400});
          }
          if (age < 21) {
            return Response.json({ok:false,message:"This client is under the 21+ screening minimum and cannot be marked Verified."},{status:400});
          }
        }
        if (verificationStatus === "unable_to_verify" && !decisionReason) {
          return Response.json({ok:false,message:"Choose a reason before marking Unable to Verify."},{status:400});
        }
        if (verificationStatus === "declined" && !decisionReason && !decisionNotes) {
          return Response.json({ok:false,message:"Add a private reason or note before declining this verification."},{status:400});
        }
        if (verificationStatus === "needs_more_information" && !decisionReason && !decisionNotes) {
          return Response.json({ok:false,message:"Add what information is still needed before using Needs More Information."},{status:400});
        }
        const reviewFlag = data.review_flag ? 1 : 0;

        const decisionChanged =
          String(previous.verification_status || "") !== verificationStatus ||
          String(previous.decision_reason || "") !== decisionReason ||
          String(previous.decision_notes || "") !== decisionNotes;
        const decisionChangeReason=String(data.decision_change_reason||"").trim().slice(0,500);
        if(previous.completed_at && decisionChanged){
          const fresh=authorizeVerificationRequest(request,env,"final_decision",{fresh:true});
          if(!fresh.ok)return verificationForbidden(fresh);
          if(!decisionChangeReason)return Response.json({ok:false,message:"Enter a reason for changing a completed verification decision."},{status:400});
        }
        if (decisionChanged && previous.verification_status && previous.verification_status !== "pending_review") {
          await env.DB.prepare(`
            INSERT INTO client_verification_decision_history
              (audit_id, client_id, verification_status, decision_reason, decision_notes,
               verification_method, completed_at, completed_by, changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            auditId, clientId, previous.verification_status, previous.decision_reason || "",
            previous.decision_notes || "", previous.verification_method || "",
            previous.completed_at || null, previous.completed_by || ""
          ).run();
        }

        const isOpenStatus = verificationStatus === "pending_review" || verificationStatus === "needs_more_information";
        const adminIdentity=accessIdentity(request).email||"authorized-admin";
        const completedBy = isOpenStatus ? "" : adminIdentity;
        const update = await env.DB.prepare(`
          UPDATE client_verification_audits
          SET verification_status = ?, verification_method = ?, submitted_industry = ?,
              identity_confirmed = ?, employer_confirmed = ?, job_title_confirmed = ?,
              industry_confirmed = ?, contact_confirmed = ?, evidence_notes = ?,
              decision_reason = ?, decision_notes = ?, birthdate = ?,
              review_flag = ?,
              completed_at = CASE
                WHEN ? IN ('pending_review','needs_more_information') THEN NULL
                WHEN verification_status<>? OR completed_at IS NULL THEN CURRENT_TIMESTAMP
                ELSE completed_at
              END,
              completed_by = CASE WHEN ? IN ('pending_review','needs_more_information') THEN '' ELSE ? END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND client_id = ?
        `).bind(
          verificationStatus, verificationMethod, submittedIndustry,
          identityConfirmed, employerConfirmed, jobTitleConfirmed,
          industryConfirmed, contactConfirmed, evidenceNotes,
          decisionReason, decisionNotes, birthdate,
          reviewFlag,
          verificationStatus, verificationStatus,
          verificationStatus, completedBy,
          auditId, clientId
        ).run();
        if (!Number(update.meta?.changes || 0)) {
          return Response.json({ ok: false, message: "Verification record not found." }, { status: 404 });
        }
        if(previous.completed_at && decisionChanged){
          await logVerificationActivity(env,clientId,auditId,"decision_changed",
            "Decision changed from "+String(previous.verification_status||"pending_review").replaceAll("_"," ")+" to "+verificationStatus.replaceAll("_"," "),
            "Reason: "+decisionChangeReason+" · Changed by "+adminIdentity);
        }
        const checklistChanged =
          Number(previous.identity_confirmed||0)!==identityConfirmed ||
          Number(previous.employer_confirmed||0)!==employerConfirmed ||
          Number(previous.job_title_confirmed||0)!==jobTitleConfirmed ||
          Number(previous.industry_confirmed||0)!==industryConfirmed ||
          Number(previous.contact_confirmed||0)!==contactConfirmed;
        if (checklistChanged) {
          await logVerificationActivity(env, clientId, auditId, "checklist_edited", "Verification checklist edited",
            [identityConfirmed,employerConfirmed,jobTitleConfirmed,industryConfirmed,contactConfirmed].filter(Boolean).length + " of 5 confirmed");
        }
        if (decisionChanged || Number(previous.review_flag||0)!==reviewFlag) {
          await logVerificationActivity(env, clientId, auditId, "decision_changed", "Verification decision changed",
            "Status: " + verificationStatus + (decisionReason ? " · Reason: " + decisionReason : "") + (reviewFlag ? " · Flagged for review" : ""));
        }

        await ensureClientIdDocumentsTable(env);
        const idStatus = verificationStatus === "verified" ? "verified" : ["pending_review","needs_more_information"].includes(verificationStatus) ? "pending_review" : "rejected";
        await env.DB.prepare(`
          UPDATE client_id_documents
          SET verification_status = ?,
              verified_at = CASE WHEN ?='verified' THEN date('now') ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
          WHERE client_id = ?
        `).bind(idStatus, idStatus, clientId).run();

        const row = await env.DB.prepare(`
          SELECT id, client_id, date_request_id, accepted, authorization_wording,
                 authorization_version, accepted_at, verification_status,
                 verification_method, submitted_employer, submitted_job_title,
                 submitted_industry, identity_confirmed, employer_confirmed,
                 job_title_confirmed, industry_confirmed, contact_confirmed,
                 evidence_notes, decision_reason, decision_notes, birthdate, completed_by, review_flag,
                 persona_transaction_id, persona_transaction_status, persona_submitted_at, persona_updated_at, completed_at, updated_at
          FROM client_verification_audits WHERE id = ? AND client_id = ? LIMIT 1
        `).bind(auditId, clientId).first();
        return Response.json({ ok: true, record: verificationAuditPublicRecord(row) }, {
          headers: { "Cache-Control": "private, no-store" }
        });
      } catch (error) {
        console.error("Update client verification audit error:", error);
        return Response.json({ ok: false, message: "Unable to update the verification record." }, { status: 500 });
      }
    }

    // =========================================================
    // PRIVATE CLIENT ID DOCUMENTS    // =========================================================
    // PRIVATE CLIENT ID DOCUMENTS
    // These routes are protected by Cloudflare Access and never
    // return an R2 object key or public bucket URL.
    // =========================================================

    if (url.pathname === "/api/admin/clients/id-document" && request.method === "GET") {
      try {
        await ensureClientIdDocumentsTable(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) {
          return Response.json({ ok: false, message: "Client not found." }, { status: 404 });
        }
        const row = await env.DB.prepare(`
          SELECT client_id, file_name, mime_type, file_size, verification_status,
                 received_at, verified_at, retention_reminder_at, created_at, updated_at
          FROM client_id_documents
          WHERE client_id = ?
          LIMIT 1
        `).bind(clientId).first();
        return Response.json({ ok: true, document: idDocumentPublicRecord(row) }, {
          headers: { "Cache-Control": "private, no-store" }
        });
      } catch (error) {
        console.error("Load client ID document error:", error);
        return Response.json({ ok: false, message: "Unable to load the ID document." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/clients/id-document/image" && request.method === "GET") {
      try {
        if (!env.ID_DOCUMENTS) {
          return Response.json({ ok: false, message: "Private ID storage is not configured." }, { status: 503 });
        }
        await ensureClientIdDocumentsTable(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) {
          return new Response("Not found", { status: 404 });
        }
        const row = await env.DB.prepare(
          "SELECT object_key, file_name, mime_type FROM client_id_documents WHERE client_id = ? LIMIT 1"
        ).bind(clientId).first();
        if (!row) return new Response("Not found", { status: 404 });
        const object = await env.ID_DOCUMENTS.get(row.object_key);
        if (!object) return new Response("Not found", { status: 404 });
        const safeName = String(row.file_name || "id-document").replace(/[\r\n"]/g, "");
        return new Response(object.body, {
          headers: {
            "Content-Type": row.mime_type,
            "Content-Disposition": 'inline; filename="' + safeName + '"',
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'"
          }
        });
      } catch (error) {
        console.error("Preview client ID document error:", error);
        return new Response("Unable to load the ID document.", { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/clients/id-document" && request.method === "POST") {
      let newObjectKey = "";
      try {
        if (!env.ID_DOCUMENTS) {
          return Response.json({ ok: false, message: "Private ID storage is not configured." }, { status: 503 });
        }
        await ensureVerificationWorkspaceTables(env);
        const form = await request.formData();
        const clientId = Number(form.get("client_id"));
        const client = await requireIdDocumentClient(env, clientId);
        if (!client) return Response.json({ ok: false, message: "Client not found." }, { status: 404 });

        const file = form.get("file");
        if (!(file instanceof File) || !file.size) {
          return Response.json({ ok: false, message: "Choose an ID image to upload." }, { status: 400 });
        }
        const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
        if (!allowedTypes.has(file.type)) {
          return Response.json({ ok: false, message: "Use a JPG, PNG, or WebP image." }, { status: 400 });
        }
        if (file.size > 10 * 1024 * 1024) {
          return Response.json({ ok: false, message: "ID images must be 10 MB or smaller." }, { status: 400 });
        }

        const allowedStatuses = new Set(["pending_review", "verified", "rejected"]);
        const verificationStatus = allowedStatuses.has(String(form.get("verification_status") || ""))
          ? String(form.get("verification_status"))
          : "pending_review";
        const receivedAt = idDocumentDate(form.get("received_at")) || idDocumentToday();
        const verifiedAt = verificationStatus === "verified"
          ? (idDocumentDate(form.get("verified_at")) || idDocumentToday())
          : null;
        const existing = await env.DB.prepare(
          "SELECT object_key, retention_reminder_at FROM client_id_documents WHERE client_id = ? LIMIT 1"
        ).bind(clientId).first();

        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        newObjectKey = "clients/" + clientId + "/id-documents/" + crypto.randomUUID() + "." + extension;
        await env.ID_DOCUMENTS.put(newObjectKey, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: { client_id: String(clientId), uploaded_for: "identity_screening" }
        });

        try {
          await env.DB.prepare(`
            INSERT INTO client_id_documents
              (client_id, object_key, file_name, mime_type, file_size, verification_status, received_at, verified_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(client_id) DO UPDATE SET
              object_key = excluded.object_key,
              file_name = excluded.file_name,
              mime_type = excluded.mime_type,
              file_size = excluded.file_size,
              verification_status = excluded.verification_status,
              received_at = excluded.received_at,
              verified_at = excluded.verified_at,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            clientId,
            newObjectKey,
            String(file.name || "id-document." + extension).slice(0, 180),
            file.type,
            file.size,
            verificationStatus,
            receivedAt,
            verifiedAt
          ).run();
        } catch (databaseError) {
          await env.ID_DOCUMENTS.delete(newObjectKey);
          throw databaseError;
        }

        if (existing?.object_key && existing.object_key !== newObjectKey) {
          await env.ID_DOCUMENTS.delete(existing.object_key);
        }
        await logVerificationActivity(
          env, clientId, null,
          existing?.object_key ? "id_replaced" : "id_uploaded",
          existing?.object_key ? "ID document replaced" : "ID document uploaded",
          "Received date: " + receivedAt
        );
        const row = await env.DB.prepare(`
          SELECT client_id, file_name, mime_type, file_size, verification_status,
                 received_at, verified_at, retention_reminder_at, created_at, updated_at
          FROM client_id_documents WHERE client_id = ? LIMIT 1
        `).bind(clientId).first();
        return Response.json({ ok: true, document: idDocumentPublicRecord(row) }, {
          headers: { "Cache-Control": "private, no-store" }
        });
      } catch (error) {
        if (newObjectKey && env.ID_DOCUMENTS) {
          try { await env.ID_DOCUMENTS.delete(newObjectKey); } catch {}
        }
        console.error("Upload client ID document error:", error);
        return Response.json({ ok: false, message: "Unable to store the ID document." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/clients/id-document/status" && request.method === "POST") {
      try {
        await ensureClientIdDocumentsTable(env);
        const data = await request.json().catch(() => ({}));
        const clientId = Number(data.client_id);
        if (!await requireIdDocumentClient(env, clientId)) {
          return Response.json({ ok: false, message: "Client not found." }, { status: 404 });
        }
        const allowedStatuses = new Set(["pending_review", "verified", "rejected"]);
        const verificationStatus = String(data.verification_status || "");
        if (!allowedStatuses.has(verificationStatus)) {
          return Response.json({ ok: false, message: "Choose a valid verification status." }, { status: 400 });
        }
        const receivedAt = idDocumentDate(data.received_at);
        if (!receivedAt) {
          return Response.json({ ok: false, message: "Enter the date the ID was received." }, { status: 400 });
        }
        const verifiedAt = verificationStatus === "verified"
          ? (idDocumentDate(data.verified_at) || idDocumentToday())
          : null;
        const update = await env.DB.prepare(`
          UPDATE client_id_documents
          SET verification_status = ?, received_at = ?, verified_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE client_id = ?
        `).bind(verificationStatus, receivedAt, verifiedAt, clientId).run();
        if (!Number(update.meta?.changes || 0)) {
          return Response.json({ ok: false, message: "Upload an ID image first." }, { status: 404 });
        }
        const row = await env.DB.prepare(`
          SELECT client_id, file_name, mime_type, file_size, verification_status,
                 received_at, verified_at, retention_reminder_at, created_at, updated_at
          FROM client_id_documents WHERE client_id = ? LIMIT 1
        `).bind(clientId).first();
        return Response.json({ ok: true, document: idDocumentPublicRecord(row) }, {
          headers: { "Cache-Control": "private, no-store" }
        });
      } catch (error) {
        console.error("Update client ID status error:", error);
        return Response.json({ ok: false, message: "Unable to update verification details." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/clients/id-document" && request.method === "DELETE") {
      try {
        if (!env.ID_DOCUMENTS) {
          return Response.json({ ok: false, message: "Private ID storage is not configured." }, { status: 503 });
        }
        await ensureClientIdDocumentsTable(env);
        const clientId = Number(url.searchParams.get("client_id"));
        if (!await requireIdDocumentClient(env, clientId)) {
          return Response.json({ ok: false, message: "Client not found." }, { status: 404 });
        }
        const deleteData = await request.json().catch(() => ({}));
        const deletionReason = String(deleteData.reason || "").trim().slice(0,500);
        const row = await env.DB.prepare(
          "SELECT object_key, file_name, created_at, received_at FROM client_id_documents WHERE client_id = ? LIMIT 1"
        ).bind(clientId).first();
        if (!row) return Response.json({ ok: true, deleted: false });
        await env.ID_DOCUMENTS.delete(row.object_key);
        await env.DB.prepare("DELETE FROM client_id_documents WHERE client_id = ?").bind(clientId).run();
        await env.DB.prepare("UPDATE client_verification_retention SET id_auto_delete=0,id_delete_at='',updated_at=CURRENT_TIMESTAMP WHERE client_id=?").bind(clientId).run();
        const actor=accessIdentity(request).email||"authorized-admin";
        await logVerificationActivity(env, clientId, null, "id_deleted", "ID document manually deleted", (deletionReason ? "Reason: " + deletionReason+" · " : "")+"Deleted by "+actor+".");
        return Response.json({ ok: true, deleted: true, deleted_document: { file_name: row.file_name || "", uploaded_at: row.created_at || "", received_at: row.received_at || "" } }, {
          headers: { "Cache-Control": "private, no-store" }
        });
      } catch (error) {
        console.error("Delete client ID document error:", error);
        return Response.json({ ok: false, message: "Unable to permanently delete the ID document." }, { status: 500 });
      }
    }

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
    if (/^\/api\/admin\/x\/library\/\d+$/.test(url.pathname)) {const id=Number(url.pathname.split("/").pop());await env.DB.prepare(`CREATE TABLE IF NOT EXISTS x_content_library (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,content TEXT NOT NULL,content_style TEXT,image_base64 TEXT,mime_type TEXT,file_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();if(request.method==="DELETE"){await env.DB.prepare("DELETE FROM x_content_library WHERE id=?").bind(id).run();return Response.json({ok:true});}if(request.method==="PUT"){const d=await request.json().catch(()=>({})),content=String(d.content||"").trim(),title=String(d.title||"").trim().slice(0,120),style=String(d.content_style||"").trim().slice(0,80);if(!content)return Response.json({ok:false,message:"Add content before saving."},{status:400});const existing=await env.DB.prepare("SELECT id FROM x_content_library WHERE id=?").bind(id).first();if(!existing)return Response.json({ok:false,message:"Library item not found."},{status:404});await env.DB.prepare("UPDATE x_content_library SET title=?,content=?,content_style=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(title||null,content,style||null,id).run();return Response.json({ok:true});}if(request.method==="POST"){const d=await request.json().catch(()=>({}));if(d.action==="mark_used"){try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN last_used_at TEXT").run();}catch(e){}await env.DB.prepare("UPDATE x_content_library SET last_used_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();return Response.json({ok:true});}if(d.action==="archive"||d.action==="restore"){try{await env.DB.prepare("ALTER TABLE x_content_library ADD COLUMN archived_at TEXT").run();}catch(e){}await env.DB.prepare("UPDATE x_content_library SET archived_at="+(d.action==="archive"?"CURRENT_TIMESTAMP":"NULL")+",updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();return Response.json({ok:true,archived:d.action==="archive"});}return Response.json({ok:false,message:"Unknown library action."},{status:400});}if(request.method==="GET"){const x=await env.DB.prepare("SELECT * FROM x_content_library WHERE id=?").bind(id).first();if(!x)return Response.json({ok:false,message:"Library item not found."},{status:404});return Response.json({ok:true,item:{...x,data_url:x.image_base64?"data:"+x.mime_type+";base64,"+x.image_base64:null}});}}

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
      { id:"signature-girlfriend-experience", experience:"Signature Girlfriend Experience", duration:"1.5 hours", price:750, label:"Signature Girlfriend Experience — 1.5 hours at $750" },
      { id:"greek-princess-experience", experience:"Greek Princess Experience", duration:"1.5 hours", price:1000, label:"Greek Princess Experience — 1.5 hours at $1,000" }
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
      { experience: "Signature Girlfriend Experience", duration: "1 hour", regular: 500, incentive: "30 extra minutes" },
      { experience: "Signature Girlfriend Experience", duration: "1.5 hours", regular: 750, incentive: "30 extra minutes" },
      { experience: "Signature Girlfriend Experience", duration: "2 hours", regular: 1000, incentive: "30 extra minutes" },
      { experience: "Signature Girlfriend Experience", duration: "4 hours", regular: 2300, incentive: "30 extra minutes" },
      { experience: "Greek Princess Experience", duration: "1 hour", regular: 700, incentive: "30 extra minutes" },
      { experience: "Greek Princess Experience", duration: "1.5 hours", regular: 1000, incentive: "30 extra minutes" },
      { experience: "Greek Princess Experience", duration: "2 hours", regular: 1300, incentive: "30 extra minutes" },
      { experience: "Greek Princess Experience", duration: "4 hours", regular: 2800, incentive: "30 extra minutes" }
    ];
    // The experiences stay fixed; the monthly incentive rotates.
    // Each month selects a base duration from 1–4 hours and adds 30 bonus minutes,
    // creating specials from 1.5 through 4.5 hours without discounting the base rate.
    const classicRates = [
      { base:"1 hour", special:"1.5 hours", price:500 },
      { base:"1.5 hours", special:"2 hours", price:750 },
      { base:"2 hours", special:"2.5 hours", price:1000 },
      { base:"4 hours", special:"4.5 hours", price:2300 }
    ];
    const greekRates = [
      { base:"1 hour", special:"1.5 hours", price:700 },
      { base:"1.5 hours", special:"2 hours", price:1000 },
      { base:"2 hours", special:"2.5 hours", price:1300 },
      { base:"4 hours", special:"4.5 hours", price:2800 }
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
        `${flirtyOfferIntros[flirtyIndex]}\n\nThis month's featured experiences:\n\nSignature Girlfriend Experience — book ${classicMonthlySpecial.base} at ${money(classicMonthlySpecial.price)} and enjoy ${classicMonthlySpecial.special}.\n\nGreek Princess Experience — book ${greekMonthlySpecial.base} at ${money(greekMonthlySpecial.price)} and enjoy ${greekMonthlySpecial.special}.\n\nThe experiences stay the same; the little extra changes each month. Choose the one that catches your eye when you're ready to make plans with me.\n\n${flirtyOfferClosers[flirtyIndex]} This little invitation is only around for ${month} and, of course, depends on my availability. 💋`
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

    // Monthly specials are aligned with the current published experience menu.
    // Signature: $500 / $750 / $1,000 / $2,300.
    // Greek Princess: $700 / $1,000 / $1,300 / $2,800.
    // Price-only specials remain under 10% off; combination offers use a smaller
    // reduction because they also include 30 extra minutes.
    const classicOptions = [
      {id:"classic-time-1",base:"1 hour",special:"1.5 hours",price:500,regular:500,type:"Extra Time",label:"Extra Time · $500 for 1 hour · enjoy 1.5 hours"},
      {id:"classic-time-15",base:"1.5 hours",special:"2 hours",price:750,regular:750,type:"Extra Time",label:"Extra Time · $750 for 1.5 hours · enjoy 2 hours"},
      {id:"classic-time-2",base:"2 hours",special:"2.5 hours",price:1000,regular:1000,type:"Extra Time",label:"Extra Time · $1,000 for up to 2 hours · enjoy 2.5 hours"},
      {id:"classic-time-4",base:"4 hours",special:"4.5 hours",price:2300,regular:2300,type:"Extra Time",label:"Extra Time · $2,300 for up to 4 hours · enjoy 4.5 hours"},
      {id:"classic-price-15",base:"1.5 hours",special:"1.5 hours",price:700,regular:750,type:"Special Price",label:"Special Price · 1.5 hours $700 · normally $750 · save $50"},
      {id:"classic-price-2",base:"2 hours",special:"2 hours",price:925,regular:1000,type:"Special Price",label:"Special Price · up to 2 hours $925 · normally $1,000 · save $75"},
      {id:"classic-price-4",base:"4 hours",special:"4 hours",price:2150,regular:2300,type:"Special Price",label:"Special Price · up to 4 hours $2,150 · normally $2,300 · save $150"},
      {id:"classic-combo-2",base:"2 hours",special:"2.5 hours",price:950,regular:1000,type:"Price + Extra Time",label:"Combo · $950 + 30 extra minutes · normally $1,000"}
    ];
    const greekOptions = [
      {id:"greek-time-1",base:"1 hour",special:"1.5 hours",price:700,regular:700,type:"Extra Time",label:"Extra Time · $700 for 1 hour · enjoy 1.5 hours"},
      {id:"greek-time-15",base:"1.5 hours",special:"2 hours",price:1000,regular:1000,type:"Extra Time",label:"Extra Time · $1,000 for 1.5 hours · enjoy 2 hours"},
      {id:"greek-time-2",base:"2 hours",special:"2.5 hours",price:1300,regular:1300,type:"Extra Time",label:"Extra Time · $1,300 for up to 2 hours · enjoy 2.5 hours"},
      {id:"greek-time-4",base:"4 hours",special:"4.5 hours",price:2800,regular:2800,type:"Extra Time",label:"Extra Time · $2,800 for up to 4 hours · enjoy 4.5 hours"},
      {id:"greek-price-15",base:"1.5 hours",special:"1.5 hours",price:925,regular:1000,type:"Special Price",label:"Special Price · 1.5 hours $925 · normally $1,000 · save $75"},
      {id:"greek-price-2",base:"2 hours",special:"2 hours",price:1200,regular:1300,type:"Special Price",label:"Special Price · up to 2 hours $1,200 · normally $1,300 · save $100"},
      {id:"greek-price-4",base:"4 hours",special:"4 hours",price:2600,regular:2800,type:"Special Price",label:"Special Price · up to 4 hours $2,600 · normally $2,800 · save $200"},
      {id:"greek-combo-2",base:"2 hours",special:"2.5 hours",price:1235,regular:1300,type:"Price + Extra Time",label:"Combo · $1,235 + 30 extra minutes · normally $1,300"}
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
    const specialsBlock = `This month's featured experiences:\n\n${offerCopy("Signature Girlfriend Experience",classic)}\n\n${offerCopy("Greek Princess Experience",greek)}\n\nChoose the experience that catches your eye when you're ready to make plans with me.`;

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
      {base:"1.5 hours",special:"2 hours",price:750},
      {base:"2 hours",special:"2.5 hours",price:1000},
      {base:"4 hours",special:"4.5 hours",price:2600}
    ];
    const greekOptions = [
      {base:"1 hour",special:"1.5 hours",price:700},
      {base:"1.5 hours",special:"2 hours",price:1000},
      {base:"2 hours",special:"2.5 hours",price:1300},
      {base:"4 hours",special:"4.5 hours",price:3000}
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
    const specialOffer = `${intros[seed]}\n\nThis month's featured experiences:\n\nSignature Girlfriend Experience — book ${classicSpecial.base} at ${classicSpecial.price} and enjoy ${classicSpecial.special}.\n\nGreek Princess Experience — book ${greekSpecial.base} at ${greekSpecial.price} and enjoy ${greekSpecial.special}.\n\nThe experiences stay the same; the little extra changes each month. Choose the one that catches your eye when you're ready to make plans with me.\n\n${closers[seed]} This little invitation is only around for ${month} and, of course, depends on my availability. 💋`;

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
    // PUBLIC SITE CONTENT, GALLERY, AND AVAILABILITY
    // =========================================================

    if (url.pathname === "/api/public/rates" && request.method === "GET") {
      return Response.json({ ok: true, services: await readSiteRates(env) });
    }

    if (url.pathname === "/api/admin/rates") {
      if (request.method === "GET") {
        return Response.json({ ok: true, services: await readSiteRates(env) });
      }
      if (request.method === "POST") {
        const data = await request.json().catch(() => ({}));
        const services = normalizeSiteRates(data.services);
        if (!services) {
          return Response.json({ ok: false, message: "Enter valid service names, descriptions, durations, and rates." }, { status: 400 });
        }
        await ensureSiteContentTables(env);
        await env.DB.prepare(`
          INSERT INTO site_settings (setting_key, setting_value, updated_at)
          VALUES ('rate_services', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = CURRENT_TIMESTAMP
        `).bind(JSON.stringify(services)).run();
        return Response.json({ ok: true, services });
      }
      return Response.json({ ok: false, message: "Method not allowed." }, { status: 405 });
    }

    if (url.pathname === "/api/public/gallery" && request.method === "GET") {
      await ensureSiteContentTables(env);
      const result = await env.DB.prepare(
        "SELECT slot, mime_type, image_base64, alt_text, updated_at FROM site_gallery ORDER BY slot"
      ).all();
      return Response.json({ ok: true, images: result.results || [] });
    }

    if (url.pathname === "/api/admin/gallery") {
      await ensureSiteContentTables(env);
      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT slot, mime_type, image_base64, alt_text, updated_at FROM site_gallery ORDER BY slot"
        ).all();
        return Response.json({ ok: true, images: result.results || [] });
      }
      const data = await request.json().catch(() => ({}));
      const slot = Number(data.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 6) {
        return Response.json({ ok: false, message: "Choose a valid gallery slot." }, { status: 400 });
      }
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM site_gallery WHERE slot = ?").bind(slot).run();
        return Response.json({ ok: true });
      }
      if (request.method === "POST") {
        const mimeType = String(data.mime_type || "").trim().toLowerCase();
        const imageBase64 = String(data.image_base64 || "").replace(/^data:[^;]+;base64,/, "");
        const altText = String(data.alt_text || "").trim().slice(0, 180);
        if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || !imageBase64 || imageBase64.length > 3000000) {
          return Response.json({ ok: false, message: "Upload a JPG, PNG, or WebP image under the gallery size limit." }, { status: 400 });
        }
        await env.DB.prepare(`
          INSERT INTO site_gallery (slot, mime_type, image_base64, alt_text, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(slot) DO UPDATE SET
            mime_type = excluded.mime_type,
            image_base64 = excluded.image_base64,
            alt_text = excluded.alt_text,
            updated_at = CURRENT_TIMESTAMP
        `).bind(slot, mimeType, imageBase64, altText).run();
        return Response.json({ ok: true, image: { slot, mime_type: mimeType, image_base64: imageBase64, alt_text: altText } });
      }
      return Response.json({ ok: false, message: "Method not allowed." }, { status: 405 });
    }

    if (url.pathname === "/api/public/availability" && request.method === "GET") {
      const date = String(url.searchParams.get("date") || "").trim();
      const duration = siteDurationMinutes(url.searchParams.get("duration") || "1-hour");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return Response.json({ ok: false, message: "Choose a valid date." }, { status: 400 });
      }
      const availability = await siteAvailableSlots(env, date, duration);
      return Response.json({
        ok: true,
        date,
        duration_minutes: duration,
        slots: availability.slots,
        availability_state: availability.availability_state
      });
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

        const preferredContact =
          String(data.preferred_contact || "").trim();

        const currentEmployer =
          String(data.current_employer || "").trim().slice(0, 160);

        const jobTitle =
          String(data.job_title || "").trim().slice(0, 160);

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

        const outcallAddressLine1 =
          String(data.outcall_address_line_1 || "").trim();

        const outcallAddressLine2 =
          String(data.outcall_address_line_2 || "").trim();

        const outcallCity =
          String(data.outcall_city || "").trim();

        const outcallState =
          String(data.outcall_state || "").trim();

        const outcallPostalCode =
          String(data.outcall_postal_code || "").trim();

        const outcallAddress = [
          outcallAddressLine1,
          outcallAddressLine2,
          outcallCity,
          outcallState,
          outcallPostalCode
        ].filter(Boolean).join(", ");

        const locationName =
          appointmentType === "outcall" ? outcallAddress : "Incall";

        const requestDetails =
          String(data.request_details || "").trim();

        const requestedStart =
          siteZonedDateTime(requestedDate, requestedTime);

        if (
          !Number.isFinite(requestedStart.getTime()) ||
          requestedStart.getTime() < Date.now() + 2 * 60 * 60 * 1000
        ) {
          return Response.json(
            {
              ok: false,
              message: "Please choose a start time at least 2 hours from the time you submit your request."
            },
            { status: 400 }
          );
        }

        const screeningAcknowledgement =
          data.screening_acknowledgement === "yes";

        const depositAcknowledgement =
          data.deposit_acknowledgement === "yes";

        const depositPaymentMethod =
          String(data.deposit_payment_method || "").trim().toLowerCase();

        const allowedDepositPaymentMethods = new Set(["gift-card", "stripe", "crypto"]);
        if (!allowedDepositPaymentMethods.has(depositPaymentMethod)) {
          return Response.json({ ok:false, message:"Please choose how you would like to secure the date." }, { status:400 });
        }

        const newsletterOfferId =
          String(data.newsletter_offer || "").trim();

        const subscriberSpecial =
          String(data.subscriber_special || "").trim();
        const monthlySpecials = {
          "signature-girlfriend-experience": { experience:"Signature Girlfriend Experience", duration:"1.5 hours", price:750 },
          "greek-princess-experience": { experience:"Greek Princess Experience", duration:"1.5 hours", price:1000 }
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
            { ok:false, message:"Please choose either the Signature Girlfriend Experience or Greek Princess Experience monthly special." },
            { status:400 }
          );
        }

        // Required fields

        if (
          !firstName ||
          !lastName ||
          !email ||
          !phone ||
          !preferredContact ||
          !currentEmployer ||
          !jobTitle ||
          !requestedDate ||
          !requestedTime ||
          !dateType ||
          !appointmentType ||
          !duration ||
          !requestDetails
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


        const allowedDateTypes = ["private-introduction", "private-uncovered-introduction", "signature-brief-introduction", "greek-princess-brief-introduction", "signature-girlfriend-experience", "greek-princess-experience"];
        const allowedAppointmentTypes = ["incall", "outcall"];
        const allowedDurations = ["20-minutes", "30-minutes", "1-hour", "1.5-hours", "2-hours", "4-hours"];
        const allowedContactMethods = ["email", "text"];

        if (
          !allowedDateTypes.includes(dateType) ||
          !allowedAppointmentTypes.includes(appointmentType) ||
          !allowedDurations.includes(duration) ||
          !allowedContactMethods.includes(preferredContact)
        ) {
          return Response.json(
            { ok: false, message: "Please choose valid booking options." },
            { status: 400 }
          );
        }

        const allowedDurationsByExperience = {
          "private-introduction": ["20-minutes"],
          "private-uncovered-introduction": ["20-minutes"],
          "signature-brief-introduction": ["30-minutes"],
          "greek-princess-brief-introduction": ["30-minutes"],
          "signature-girlfriend-experience": ["1-hour", "1.5-hours", "2-hours", "4-hours"],
          "greek-princess-experience": ["1-hour", "1.5-hours", "2-hours", "4-hours"]
        };

        if (!allowedDurationsByExperience[dateType]?.includes(duration)) {
          return Response.json(
            { ok: false, message: "Please choose a duration available for the selected experience." },
            { status: 400 }
          );
        }


        if (
          appointmentType === "outcall" &&
          (!outcallAddressLine1 || !outcallCity || !outcallState || !outcallPostalCode)
        ) {
          return Response.json(
            { ok: false, message: "Please complete the outcall address." },
            { status: 400 }
          );
        }

        const availability = await siteAvailableSlots(
          env,
          requestedDate,
          siteDurationMinutes(duration)
        );
        if (!availability.slots.includes(requestedTime.slice(0, 5))) {
          return Response.json(
            { ok: false, message: "That start time is no longer available. Please choose another opening." },
            { status: 409 }
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
            "Preferred contact after confirmation: " + preferredContact,
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
              (client_id, requested_date, requested_time, location_name, location_address, status, deposit_amount, deposit_paid, id_received, final_approval, notes)
             VALUES (?, ?, ?, ?, ?, 'blacklisted_submission', 0, 0, 0, 0, ?)`
          ).bind(
            flaggedClientId,
            requestedDate,
            requestedTime,
            appointmentType === "outcall" ? "Outcall" : "Incall",
            appointmentType === "outcall" ? outcallAddress : null,
            flagNotes
          ).run();

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

          preferredContact
            ? `Preferred contact after confirmation: ${preferredContact}`
            : null,

          currentEmployer
            ? `Current employer: ${currentEmployer}`
            : null,

          jobTitle
            ? `Job title: ${jobTitle}`
            : null,

          appointmentType === "outcall" && outcallAddress
            ? `Outcall address: ${outcallAddress}`
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
            ? "Deposit requirement acknowledged: Yes"
            : null,

          depositPaymentMethod
            ? `Deposit payment method: ${depositPaymentMethod}`
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
                location_address,
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
              appointmentType === "outcall" ? "Outcall" : "Incall",
              appointmentType === "outcall" ? outcallAddress : null,
              notes
            )
            .run();


        const requestId =
          requestResult.meta.last_row_id;

        // Preserve the screening acknowledgement exactly as presented when
        // this booking request was submitted. This is an audit record only;
        // it does not add or change wording on the public form.
        await ensureClientVerificationAuditsTable(env);
        await env.DB.prepare(`
          INSERT INTO client_verification_audits
            (client_id, date_request_id, accepted, authorization_wording,
             authorization_version, accepted_at, verification_status, verification_method,
             submitted_employer, submitted_job_title, submitted_industry)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending_review', 'Booking form acknowledgement', ?, ?, ?)
          ON CONFLICT(date_request_id) DO NOTHING
        `).bind(
          clientId,
          requestId,
          screeningAcknowledgement ? 1 : 0,
          SCREENING_ACKNOWLEDGEMENT_WORDING,
          SCREENING_ACKNOWLEDGEMENT_VERSION,
          currentEmployer,
          jobTitle,
          ""
        ).run();


        // Do not create an email draft when a booking request is submitted.
        // The first client email is created only when the request is moved
        // forward for ID screening and deposit instructions.

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
          recordedPayments,
          recentRequests
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
            .first(),

          env.DB
            .prepare(
              `
              SELECT id, first_name, last_name, status, requested_date, requested_time, created_at
              FROM date_requests
              ORDER BY datetime(created_at) DESC, id DESC
              LIMIT 6
              `
            )
            .all()
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
          },

          recent_requests:
            recentRequests?.results ?? []
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
    // RESCHEDULE BOOKING — available for current booking requests
    // =========================================================
    if (url.pathname === "/api/admin/request/reschedule" && request.method === "POST") {
      try {
        const data=await request.json();
        const requestId=Number(data.id);
        const requestedDate=String(data.requested_date||"").trim();
        const requestedTime=String(data.requested_time||"").trim().slice(0,5);
        if(!Number.isInteger(requestId)||requestId<1) return Response.json({ok:false,message:"Invalid request ID."},{status:400});
        if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)||!/^\d{2}:\d{2}$/.test(requestedTime)) return Response.json({ok:false,message:"Choose a valid new date and time."},{status:400});
        const item=await env.DB.prepare("SELECT id,status,notes,requested_date,requested_time FROM date_requests WHERE id=? LIMIT 1").bind(requestId).first();
        if(!item) return Response.json({ok:false,message:"Booking request not found."},{status:404});
        if(["declined","no_call_no_show","canceled","completed","blacklisted_submission"].includes(String(item.status||"").toLowerCase())) return Response.json({ok:false,message:"This booking can no longer be rescheduled."},{status:400});
        const duration=siteBookingDurationFromNotes(item.notes);
        const availability=await siteAvailableSlots(env,requestedDate,duration,requestId);
        if(!(availability.slots||[]).includes(requestedTime)) return Response.json({ok:false,message:"That time is not available. Choose another date or time."},{status:409});
        const oldDate=item.requested_date,oldTime=item.requested_time;
        await env.DB.prepare("UPDATE date_requests SET requested_date=?, requested_time=? WHERE id=?").bind(requestedDate,requestedTime,requestId).run();
        await env.DB.prepare(`
          UPDATE email_drafts
          SET body=replace(replace(body, ?, ?), ?, ?)
          WHERE date_request_id=? AND COALESCE(status,'draft')!='sent'
        `).bind(String(oldDate||""),requestedDate,String(oldTime||""),requestedTime,requestId).run();
        return Response.json({ok:true,requested_date:requestedDate,requested_time:requestedTime,message:"Appointment rescheduled."});
      } catch(error) {
        console.error("Reschedule booking error:",error);
        return Response.json({ok:false,message:"Unable to reschedule appointment."},{status:500});
      }
    }


    // =========================================================
    // BOOKING OUTCOME — available for new and existing requests
    // =========================================================
    if (url.pathname === "/api/admin/request/outcome" && request.method === "POST") {
      try {
        const data=await request.json();
        const requestId=Number(data.id);
        const outcome=String(data.outcome||"").trim().toLowerCase();
        if(!Number.isInteger(requestId)||requestId<1) return Response.json({ok:false,message:"Invalid request ID."},{status:400});
        if(!["declined","no_call_no_show"].includes(outcome)) return Response.json({ok:false,message:"Invalid booking outcome."},{status:400});
        const item=await env.DB.prepare("SELECT id,status,final_approval FROM date_requests WHERE id=? LIMIT 1").bind(requestId).first();
        if(!item) return Response.json({ok:false,message:"Booking request not found."},{status:404});
        if(outcome==="no_call_no_show" && !Number(item.final_approval||0)) {
          return Response.json({ok:false,message:"No Call / No Show can only be used for a confirmed booking."},{status:400});
        }
        await env.DB.prepare("UPDATE date_requests SET status=?, final_approval=CASE WHEN ?='declined' THEN 0 ELSE final_approval END WHERE id=?")
          .bind(outcome,outcome,requestId).run();
        return Response.json({ok:true,status:outcome});
      } catch(error) {
        console.error("Booking outcome error:",error);
        return Response.json({ok:false,message:"Unable to update booking."},{status:500});
      }
    }


    // =========================================================
    // ADMIN CALENDAR WORK HOURS
    // =========================================================

    if (url.pathname === "/api/admin/calendar/work-hours") {
      await ensureSiteContentTables(env);

      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT day_of_week, enabled, start_time, end_time FROM calendar_work_hours ORDER BY day_of_week"
        ).all();
        return Response.json({
          ok: true,
          items: (result.results || []).map(item => ({
            day_of_week: Number(item.day_of_week),
            enabled: Number(item.enabled) === 1,
            start_time: String(item.start_time || "10:00").slice(0, 5),
            end_time: String(item.end_time || "22:00").slice(0, 5)
          }))
        });
      }

      if (request.method === "POST") {
        const data = await request.json().catch(() => ({}));
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length !== 7) {
          return Response.json({ ok: false, message: "Work hours must include all seven days." }, { status: 400 });
        }
        const normalized = [];
        for (const item of items) {
          const day = Number(item.day_of_week);
          const enabled = item.enabled ? 1 : 0;
          const start = String(item.start_time || "").slice(0, 5);
          const end = String(item.end_time || "").slice(0, 5);
          const startMinutes = siteMinutesFromTime(start);
          const endMinutes = siteMinutesFromTime(end);
          if (!Number.isInteger(day) || day < 0 || day > 6 || startMinutes === null || endMinutes === null || (enabled && endMinutes <= startMinutes)) {
            return Response.json({ ok: false, message: "Choose valid start and end times for each enabled work day." }, { status: 400 });
          }
          normalized.push({ day_of_week: day, enabled, start_time: start, end_time: end });
        }
        if (new Set(normalized.map(item => item.day_of_week)).size !== 7) {
          return Response.json({ ok: false, message: "Each day can only appear once." }, { status: 400 });
        }
        await env.DB.batch(normalized.map(item =>
          env.DB.prepare(`
            INSERT INTO calendar_work_hours (day_of_week, enabled, start_time, end_time, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(day_of_week) DO UPDATE SET
              enabled = excluded.enabled,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              updated_at = CURRENT_TIMESTAMP
          `).bind(item.day_of_week, item.enabled, item.start_time, item.end_time)
        ));
        return Response.json({
          ok: true,
          items: normalized.map(item => ({ ...item, enabled: item.enabled === 1 }))
        });
      }

      return Response.json({ ok: false, message: "Method not allowed." }, { status: 405 });
    }


    // =========================================================
    // ADMIN CALENDAR AVAILABILITY
    // =========================================================

    if (url.pathname === "/api/admin/calendar/availability") {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS calendar_availability (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          available_date TEXT NOT NULL,
          available_time TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(available_date, available_time)
        )
      `).run();

      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT available_date AS date, available_time AS time FROM calendar_availability ORDER BY available_date, available_time"
        ).all();
        return Response.json({ ok: true, items: result.results || [] });
      }

      const data = await request.json().catch(() => ({}));
      const date = String(data.date || "").trim();
      const time = String(data.time || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
        return Response.json({ ok: false, message: "Choose a valid availability date and time." }, { status: 400 });
      }

      if (request.method === "POST") {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO calendar_availability (available_date, available_time) VALUES (?, ?)"
        ).bind(date, time).run();
        return Response.json({ ok: true, item: { date, time } });
      }

      if (request.method === "DELETE") {
        await env.DB.prepare(
          "DELETE FROM calendar_availability WHERE available_date = ? AND available_time = ?"
        ).bind(date, time).run();
        return Response.json({ ok: true });
      }

      return Response.json({ ok: false, message: "Method not allowed." }, { status: 405 });
    }


    // =========================================================
    // CLEAR BOOKING SUBMISSIONS
    // =========================================================

    if (
      url.pathname === "/api/admin/requests/clear" &&
      request.method === "POST"
    ) {
      try {
        const countRow = await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM date_requests"
        ).first();

        await ensureClientVerificationAuditsTable(env);
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM client_verification_audits WHERE date_request_id IS NOT NULL"
          ),
          env.DB.prepare(
            "DELETE FROM email_drafts WHERE date_request_id IS NOT NULL"
          ),
          env.DB.prepare(
            "DELETE FROM payments WHERE date_request_id IS NOT NULL"
          ),
          env.DB.prepare("DELETE FROM date_requests")
        ]);

        return Response.json({
          ok: true,
          deleted: Number(countRow?.total || 0)
        });
      } catch (error) {
        console.error("Clear admin requests error:", error);
        return Response.json(
          { ok: false, message: "Unable to clear booking submissions." },
          { status: 500 }
        );
      }
    }

    // =========================================================
    // DELETE SELECTED TEST CLIENT PROFILES
    // =========================================================

    if (
      url.pathname === "/api/admin/clients/delete-selected" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json().catch(() => ({}));
        const ids = [...new Set(
          (Array.isArray(data.ids) ? data.ids : [])
            .map(Number)
            .filter(id => Number.isInteger(id) && id > 0)
        )];

        if (!ids.length || ids.length > 100) {
          return Response.json(
            { ok: false, message: "Choose one or more valid client records." },
            { status: 400 }
          );
        }

        const placeholders = ids.map(() => "?").join(",");
        const existing = await env.DB.prepare(
          `SELECT id FROM clients WHERE id IN (${placeholders})`
        ).bind(...ids).all();
        const existingIds = (existing.results || []).map(row => Number(row.id));

        if (!existingIds.length) {
          return Response.json({ ok: true, deleted: 0 });
        }

        const existingPlaceholders = existingIds.map(() => "?").join(",");
        await ensureClientIdDocumentsTable(env);
        const idDocuments = await env.DB.prepare(
          `SELECT object_key FROM client_id_documents WHERE client_id IN (${existingPlaceholders})`
        ).bind(...existingIds).all();
        if (env.ID_DOCUMENTS) {
          await Promise.all((idDocuments.results || []).map(item =>
            env.ID_DOCUMENTS.delete(item.object_key).catch(() => {})
          ));
        }
        await env.DB.batch([
          env.DB.prepare(
            `DELETE FROM client_id_documents WHERE client_id IN (${existingPlaceholders})`
          ).bind(...existingIds),
          env.DB.prepare(
            `DELETE FROM email_drafts WHERE client_id IN (${existingPlaceholders})`
          ).bind(...existingIds),
          env.DB.prepare(
            `DELETE FROM payments WHERE client_id IN (${existingPlaceholders})`
          ).bind(...existingIds),
          env.DB.prepare(
            `DELETE FROM date_requests WHERE client_id IN (${existingPlaceholders})`
          ).bind(...existingIds),
          env.DB.prepare(
            `DELETE FROM blacklist WHERE client_id IN (${existingPlaceholders})`
          ).bind(...existingIds),
          env.DB.prepare(
            `DELETE FROM clients WHERE id IN (${existingPlaceholders})`
          ).bind(...existingIds)
        ]);

        return Response.json({ ok: true, deleted: existingIds.length });
      } catch (error) {
        console.error("Delete selected clients error:", error);
        return Response.json(
          { ok: false, message: "Unable to delete the selected client records." },
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
                et.opened_at,
                et.last_opened_at,
                et.open_count,
                et.responded_at,
                et.provider_email_id,
                c.first_name,
                c.last_name,
                c.email
              FROM email_drafts ed
              LEFT JOIN clients c
                ON c.id = ed.client_id
              LEFT JOIN email_tracking et
                ON et.email_draft_id = ed.id
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

    if (
      url.pathname.match(/^\/api\/admin\/email-drafts\/\d+$/) &&
      request.method === "DELETE"
    ) {
      try {
        const id=Number(url.pathname.split("/").pop());
        if(!Number.isInteger(id)||id<=0) return Response.json({ok:false,message:"Invalid email draft ID."},{status:400});
        const existing=await env.DB.prepare("SELECT id FROM email_drafts WHERE id=? LIMIT 1").bind(id).first();
        if(!existing) return Response.json({ok:false,message:"Email draft not found."},{status:404});
        await env.DB.prepare("DELETE FROM email_drafts WHERE id=?").bind(id).run();
        return Response.json({ok:true,deleted:id});
      } catch(error) {
        console.error("Delete email draft error:",error);
        return Response.json({ok:false,message:"Unable to delete email draft."},{status:500});
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
        const sendData = await sendResponse.json().catch(() => ({}));
        await env.DB.prepare("UPDATE email_drafts SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(draftId).run();
        await env.DB.prepare(`
          INSERT INTO email_tracking (email_draft_id, provider_email_id, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(email_draft_id) DO UPDATE SET provider_email_id=excluded.provider_email_id, updated_at=CURRENT_TIMESTAMP
        `).bind(draftId, String(sendData.id || "")).run();
        return Response.json({ ok:true, message:"Email sent to " + draft.email + ".", status:"sent" });
      } catch (error) {
        console.error("Client email send error:", error);
        return Response.json({ ok:false, message:"Unable to send this email." }, { status:500 });
      }
    }


    // =========================================================
    // ADMIN GOVERNMENT ID VERIFICATION (Persona API)
    // The client never enters Persona. An authorized admin uploads
    // the ID in ClearPath, then this route submits that stored image.
    // =========================================================
    if (url.pathname === "/api/admin/clients/persona-status" && request.method === "GET") {
      await ensureVerificationWorkspaceTables(env);
      const apiKeyConfigured = Boolean(normalizePersonaConfigValue(env.PERSONA_API_KEY));
      const inquiryTemplateId = normalizePersonaConfigValue(env.PERSONA_INQUIRY_TEMPLATE_ID);
      const inquiryTemplateConfigured = /^itmpl_[A-Za-z0-9]+$/.test(inquiryTemplateId);
      const webhookSecretConfigured = Boolean(env.PERSONA_WEBHOOK_SECRET);
      const requiredFields = String(env.PERSONA_REQUIRED_FIELDS || "")
        .split(",").map(value => value.trim()).filter(Boolean);
      const effectiveRequiredFields = requiredFields.length ? requiredFields : ["name_first","name_last","birthdate"];
      return Response.json({
        ok:true,
        connected:apiKeyConfigured && inquiryTemplateConfigured,
        setup_state:apiKeyConfigured && inquiryTemplateConfigured ? "connected" : "pending_setup",
        required_fields:effectiveRequiredFields,
        required_fields_configured:requiredFields.length>0,
        webhook_connected:webhookSecretConfigured,
        api_key_configured:apiKeyConfigured,
        inquiry_template_configured:inquiryTemplateConfigured,
        configuration_message:!apiKeyConfigured
          ? "Add PERSONA_API_KEY to the Worker environment."
          : !inquiryTemplateId
            ? "Add PERSONA_INQUIRY_TEMPLATE_ID to the Worker environment."
            : !inquiryTemplateConfigured
              ? "PERSONA_INQUIRY_TEMPLATE_ID must be a Persona Inquiry Template ID beginning with itmpl_."
              : "",
        webhook_secret_configured:webhookSecretConfigured,
        webhook_url:"https://kendrabexly.com/api/webhooks/persona",
        webhook_health:await (async()=>{
          const health=await env.DB.prepare("SELECT last_received_at,last_success_at,last_rejected_at FROM persona_webhook_health WHERE id=1").first()||{};
          const active=await env.DB.prepare(`
            SELECT persona_submitted_at FROM client_verification_audits
            WHERE persona_transaction_id<>'' AND LOWER(persona_transaction_status) IN ('created','pending','processing','needs_review','pending_fallback_inquiry')
            ORDER BY persona_submitted_at DESC LIMIT 1
          `).first();
          const submitted=active?.persona_submitted_at?new Date(String(active.persona_submitted_at).replace(" ","T")+"Z").getTime():0;
          const success=health.last_success_at?new Date(String(health.last_success_at).replace(" ","T")+"Z").getTime():0;
          return {...health,warning:Boolean(submitted&&Date.now()-submitted>15*60*1000&&success<submitted)};
        })()
      }, {headers:{"Cache-Control":"private, no-store"}});
    }

    if (url.pathname === "/api/admin/clients/persona-test" && request.method === "POST") {
      try {
        const actor=accessIdentity(request).email||"admin";
        const rate=await enforceVerificationRateLimit(env,"persona_test",actor,10,300);
        if(!rate.ok)return Response.json({ok:false,code:"rate_limited",message:"Too many Persona connection tests. Try again shortly."},{status:429,headers:{"Retry-After":String(rate.retry_after)}});
        const result=await fetchPersonaInquiryTemplateConfig(env);
        return Response.json(result,{status:result.ok?200:(result.state==="invalid_credentials"?401:result.state==="incorrect_inquiry_template"?400:502),headers:{"Cache-Control":"private, no-store"}});
      } catch (error) {
        return Response.json({ok:false,state:"connection_error",message:"Persona connection error",technical_details:String(error?.message||error)},{status:502,headers:{"Cache-Control":"private, no-store"}});
      }
    }

    if (url.pathname === "/api/admin/clients/persona-verify" && request.method === "POST") {
      try {
        if (!env.PERSONA_API_KEY) {
          return Response.json({
            ok:false,
            message:"Persona setup is still pending. Manual verification remains available.",
            technical_details:"PERSONA_API_KEY is missing."
          }, {status:503});
        }
        await ensureVerificationWorkspaceTables(env);
        const personaConfig=await fetchPersonaInquiryTemplateConfig(env);
        if(!personaConfig.ok){
          return Response.json({ok:false,message:personaConfig.message,technical_details:personaConfig.technical_details,connection_state:personaConfig.state},{status:personaConfig.state==="invalid_credentials"?401:personaConfig.state==="incorrect_inquiry_template"?400:502});
        }
        const personaInquiryTemplateId=String(personaConfig.inquiry_template_id||"").trim();
        if(!/^itmpl_[A-Za-z0-9]+$/.test(personaInquiryTemplateId)){
          return Response.json({ok:false,message:"Persona setup is still pending. Manual verification remains available.",technical_details:"No usable Persona Inquiry Template is available."},{status:503});
        }

        const data = await request.json().catch(() => ({}));
        const clientId = Number(data.client_id);
        let requestId = Number(data.booking_request_id);
        const incomingFields = data.persona_fields && typeof data.persona_fields === "object" ? data.persona_fields : {};
        const supportedPersonaFields = new Set(personaConfig.supported_fields || []);
        const allowedPersonaFields = [
          "name_first","name_middle","name_last","birthdate",
          "address_street_1","address_street_2","address_city",
          "address_subdivision","address_postal_code","address_country_code",
          "email_address","phone_number"
        ].filter(key=>supportedPersonaFields.has(key));
        let personaFields = {};
        const collapseSpaces = (value) => String(value || "").trim().replace(/\s+/g, " ");
        for (const key of allowedPersonaFields) {
          let value = collapseSpaces(incomingFields[key]);
          if (!value) continue;
          if (key === "email_address") value = value.toLowerCase().replace(/\s+/g,"").replace(/[;,]+$/,"");
          if (key === "phone_number") value = normalizeVerificationPhone(value);
          personaFields[key] = value;
        }
        personaFields = normalizeVerificationAddressFields(personaFields);
        if (!personaFields.address_country_code) personaFields.address_country_code = "US";
        if (
          personaFields.address_street_1 &&
          personaFields.address_street_2 &&
          personaFields.address_street_1.toLowerCase() === personaFields.address_street_2.toLowerCase()
        ) delete personaFields.address_street_2;

        if (!Number.isInteger(clientId) || clientId < 1) {
          return Response.json({ok:false,message:"Choose a valid client."},{status:400});
        }
        const sensitive = await env.DB.prepare(
          "SELECT encrypted_id_number, id_class, issuing_state, expiration_date FROM client_verification_sensitive_fields WHERE client_id=? LIMIT 1"
        ).bind(clientId).first();
        let savedIdNumber="";
        if (sensitive?.encrypted_id_number) {
          try { savedIdNumber=await decryptVerificationField(env,sensitive.encrypted_id_number); }
          catch(error) { return Response.json({ok:false,message:"Saved ID details could not be decrypted.",technical_details:String(error?.message||error)},{status:500}); }
        }
        const idNumberField=firstSupportedPersonaField(supportedPersonaFields,PERSONA_ID_NUMBER_FIELD_CANDIDATES);
        const idClassField=firstSupportedPersonaField(supportedPersonaFields,PERSONA_ID_CLASS_FIELD_CANDIDATES);
        const issuingStateField=firstSupportedPersonaField(supportedPersonaFields,PERSONA_ISSUING_STATE_FIELD_CANDIDATES);
        const expirationField=firstSupportedPersonaField(supportedPersonaFields,PERSONA_EXPIRATION_FIELD_CANDIDATES);
        if(idNumberField&&savedIdNumber)personaFields[idNumberField]=savedIdNumber;
        if(idClassField&&sensitive?.id_class)personaFields[idClassField]=String(sensitive.id_class);
        if(issuingStateField&&sensitive?.issuing_state)personaFields[issuingStateField]=String(sensitive.issuing_state);
        if(expirationField&&sensitive?.expiration_date)personaFields[expirationField]=String(sensitive.expiration_date);

        const addressComplete=Boolean(personaFields.address_street_1&&personaFields.address_city&&personaFields.address_subdivision&&personaFields.address_postal_code);
        const idFallbackComplete=Boolean(personaFields.name_first&&personaFields.name_last&&personaFields.birthdate&&savedIdNumber&&sensitive?.issuing_state);
        const fallbackErrors=[];
        if(!personaFields.name_first)fallbackErrors.push({field:"name_first",message:"First name is required."});
        if(!personaFields.name_last)fallbackErrors.push({field:"name_last",message:"Last name is required."});
        if(!personaFields.birthdate)fallbackErrors.push({field:"birthdate",message:"DOB is required."});
        if(!addressComplete&&!idFallbackComplete){
          if(!savedIdNumber)fallbackErrors.push({field:"id_number",message:"Enter a DL/State ID number when address is unavailable."});
          if(!sensitive?.issuing_state)fallbackErrors.push({field:"issuing_state",message:"Issuing state is required when address is unavailable."});
        }
        if(fallbackErrors.length){
          return Response.json({ok:false,message:"Complete either the address or the DL/State ID fallback.",field_errors:fallbackErrors},{status:400});
        }
        const addressFields=new Set(["address_street_1","address_street_2","address_city","address_subdivision","address_postal_code","address_country_code"]);
        const requiredFields=(personaConfig.required_fields || []).filter(field=>!(idFallbackComplete&&addressFields.has(field)));
        const missingRequired = requiredFields.filter(key=>!String(personaFields[key]||"").trim());
        if (missingRequired.length) {
          return Response.json({ok:false,message:"Complete all fields required by the configured Persona Inquiry Template.",missing_fields:missingRequired},{status:400});
        }
        if (personaFields.address_country_code && !/^[A-Z]{2}$/.test(personaFields.address_country_code)) {
          return Response.json({ok:false,message:"Country code must use a two-letter code such as US.",field_errors:["Country code must contain two letters."]},{status:400});
        }
        if (personaFields.address_country_code === "US" && personaFields.address_subdivision && !VALID_US_STATE_CODES.has(personaFields.address_subdivision)) {
          return Response.json({ok:false,message:"State must use a valid two-letter U.S. abbreviation.",field_errors:[{field:"address_subdivision",message:"State is invalid."}]},{status:400});
        }
        if (personaFields.address_country_code === "US" && personaFields.address_postal_code && !/^\d{5}(?:-\d{4})?$/.test(personaFields.address_postal_code)) {
          return Response.json({ok:false,message:"Enter a valid U.S. ZIP code.",field_errors:[{field:"address_postal_code",message:"Postal code must be 12345 or 12345-6789."}]},{status:400});
        }
        if (personaFields.email_address && !verificationEmailValid(personaFields.email_address)) {
          return Response.json({ok:false,message:"Enter a valid email address before submitting to Persona.",field_errors:[{field:"email_address",message:"Email format is invalid."}]},{status:400});
        }
        if (personaFields.phone_number) {
          const digits=personaFields.phone_number.replace(/\D/g,"");
          if (!(digits.length===11&&digits.startsWith("1"))) {
            return Response.json({ok:false,message:"Enter a complete U.S. phone number before submitting to Persona.",field_errors:[{field:"phone_number",message:"Phone number is incomplete."}]},{status:400});
          }
        }
        if (!await requireIdDocumentClient(env, clientId)) {
          return Response.json({ok:false,message:"Client not found."},{status:404});
        }

        if (!Number.isInteger(requestId) || requestId < 1) {
          const latestRequest = await env.DB.prepare(
            "SELECT id FROM date_requests WHERE client_id=? ORDER BY created_at DESC, id DESC LIMIT 1"
          ).bind(clientId).first();
          requestId = Number(latestRequest?.id || 0);
        }
        if (!requestId) {
          return Response.json({ok:false,message:"This client does not have a booking request to attach the verification record to."},{status:400});
        }
        const ownedRequest=await env.DB.prepare("SELECT id FROM date_requests WHERE id=? AND client_id=? LIMIT 1").bind(requestId,clientId).first();
        if(!ownedRequest)return Response.json({ok:false,message:"The selected booking request does not belong to this client."},{status:400});
        const actor=accessIdentity(request).email||"admin";
        const personaRate=await enforceVerificationRateLimit(env,"persona_verify",actor+":"+clientId,5,600);
        if(!personaRate.ok)return Response.json({ok:false,code:"rate_limited",message:"Too many Persona submissions for this client. Refresh the current status before trying again."},{status:429,headers:{"Retry-After":String(personaRate.retry_after)}});

        let audit = await env.DB.prepare(
          "SELECT id, date_request_id, persona_transaction_id, persona_transaction_status FROM client_verification_audits WHERE client_id=? AND date_request_id=? LIMIT 1"
        ).bind(clientId, requestId).first();
        if (!audit) {
          await env.DB.prepare(`
            INSERT INTO client_verification_audits
              (client_id, date_request_id, accepted, authorization_wording,
               authorization_version, accepted_at, verification_status, verification_method)
            VALUES (?, ?, 0, 'Screening acknowledgement was not recorded for this legacy booking request.',
                    'legacy-unrecorded', CURRENT_TIMESTAMP, 'pending_review', 'Admin verification')
            ON CONFLICT(date_request_id) DO NOTHING
          `).bind(clientId, requestId).run();
          audit = await env.DB.prepare(
            "SELECT id, date_request_id, persona_transaction_id, persona_transaction_status FROM client_verification_audits WHERE client_id=? AND date_request_id=? LIMIT 1"
          ).bind(clientId, requestId).first();
        }
        if (!audit) {
          return Response.json({ok:false,message:"Unable to create the verification audit for this booking request."},{status:500});
        }
        const existingPersonaId = String(audit.persona_transaction_id || "");
        const existingPersonaStatus = String(audit.persona_transaction_status || "").toLowerCase();
        const activePersonaStatuses = new Set(["created","pending","needs_review","pending_fallback_inquiry","processing"]);
        const retryablePersonaStatuses = new Set(["declined","errored","failed"]);
        const forceNewPersona=Boolean(data.force_new_persona);
        if (existingPersonaId) {
          if ((activePersonaStatuses.has(existingPersonaStatus) || !existingPersonaStatus) && !forceNewPersona) {
            return Response.json({ok:false,code:"persona_already_pending",message:"A Persona verification is already pending for this client.",existing_transaction:{id:existingPersonaId,status:existingPersonaStatus||"pending"},retry_allowed:false,new_test_allowed:true},{status:409});
          }
          if (existingPersonaStatus === "approved" && !forceNewPersona) {
            return Response.json({ok:false,code:"persona_already_approved",message:"Persona already returned Approved for this client. Use the existing result.",existing_transaction:{id:existingPersonaId,status:existingPersonaStatus},retry_allowed:false,new_test_allowed:true},{status:409});
          }
          if (retryablePersonaStatuses.has(existingPersonaStatus) && !data.retry_persona && !forceNewPersona) {
            return Response.json({ok:false,code:"persona_retry_required",message:"The previous Persona verification ended without approval. Use Retry Persona if you want to submit it again.",existing_transaction:{id:existingPersonaId,status:existingPersonaStatus},retry_allowed:true,new_test_allowed:true},{status:409});
          }
        }

        const idempotencyKey="clearpath-"+crypto.randomUUID();
        const previousAttempt=await env.DB.prepare("SELECT id FROM persona_verification_attempts WHERE client_id=? ORDER BY id DESC LIMIT 1").bind(clientId).first();
        await env.DB.prepare(`
          INSERT INTO persona_verification_attempts(client_id,audit_id,transaction_status,idempotency_key,replaces_attempt_id,submitted_at,updated_at)
          VALUES(?,?,'submitting',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        `).bind(clientId,audit.id,idempotencyKey,(data.retry_persona||forceNewPersona)?Number(previousAttempt?.id||0)||null:null).run();
        const attempt=await env.DB.prepare("SELECT id FROM persona_verification_attempts WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first();
        const headers = {
          Authorization: "Bearer " + String(env.PERSONA_API_KEY),
          "Content-Type": "application/json",
          "Key-Inflection": "kebab",
          "Idempotency-Key": idempotencyKey
        };
        if (env.PERSONA_API_VERSION) headers["Persona-Version"] = String(env.PERSONA_API_VERSION);

        let personaResponse,personaData={};
        const snakeInquiryFields=Object.fromEntries(Object.entries(personaFields));
        const kebabInquiryFields=Object.fromEntries(Object.entries(personaFields).map(([key,value])=>[key.replaceAll("_","-"),value]));
        const pickFields=(source,keys)=>Object.fromEntries(keys.filter(key=>source[key]!==undefined&&source[key]!==null&&source[key]!=="").map(key=>[key,source[key]]));

        const useCurrentPersonaFields=String(env.PERSONA_API_VERSION||"")>="2025-10-27";
        const fieldSets=[
          {
            style:"snake",
            full:snakeInquiryFields,
            address:pickFields(snakeInquiryFields,[
              "name_first","name_middle","name_last","birthdate",
              "address_street_1","address_street_2","address_city","address_subdivision","address_postal_code","address_country_code"
            ]),
            core:pickFields(snakeInquiryFields,["name_first","name_last","birthdate","address_country_code"])
          },
          {
            style:"kebab",
            full:kebabInquiryFields,
            address:pickFields(kebabInquiryFields,[
              "name-first","name-middle","name-last","birthdate",
              "address-street-1","address-street-2","address-city","address-subdivision","address-postal-code","address-country-code"
            ]),
            core:pickFields(kebabInquiryFields,["name-first","name-last","birthdate","address-country-code"])
          }
        ];
        if(!useCurrentPersonaFields)fieldSets.reverse();

        const submissionProfiles=[];
        // Persona Support requested that Sandbox inquiry creation be tested first
        // with the exact Inquiry Template schema keys and no extra fields.
        // For explicit "Start New Persona Test" requests, try the minimal snake-case
        // payload first: name_first, name_last, birthdate, address_country_code.
        if(forceNewPersona){
          submissionProfiles.push({
            name:"support_exact_sandbox",
            fields:pickFields(snakeInquiryFields,[
              "name_first","name_last","birthdate","address_country_code"
            ])
          });
        }
        for(const set of fieldSets){
          submissionProfiles.push(
            {name:set.style+"_full",fields:set.full},
            {name:set.style+"_identity_address",fields:set.address},
            {name:set.style+"_core_identity",fields:set.core}
          );
        }
        const uniqueProfiles=submissionProfiles.filter((profile,index,array)=>
          Object.keys(profile.fields).length&&array.findIndex(other=>JSON.stringify(other.fields)===JSON.stringify(profile.fields))===index
        );
        // Final Sandbox compatibility attempt also uses the exact template schema
        // keys requested by Persona Support (underscores, not kebab-case).
        uniqueProfiles.push({
          name:"persona_support_exact_no_reference",
          fields:pickFields(snakeInquiryFields,["name_first","name_last","birthdate","address_country_code"]),
          omitReferenceId:true,
          forceSandboxVersion:true
        });

        let acceptedProfile="";
        let finalPersonaRequestId="";
        let lastErrorDetail="";
        for(let profileIndex=0;profileIndex<uniqueProfiles.length;profileIndex++){
          const profile=uniqueProfiles[profileIndex];
          const requestHeaders={...headers,"Idempotency-Key":profileIndex===0?idempotencyKey:idempotencyKey+"-"+profile.name};
          if(profile.forceSandboxVersion && /^persona_sandbox_/i.test(String(env.PERSONA_API_KEY||"")) && !env.PERSONA_API_VERSION){
            requestHeaders["Persona-Version"]="2023-01-05";
          }
          const controller=new AbortController();
          const timeout=setTimeout(()=>controller.abort(),12000);
          try{
            personaResponse = await fetch("https://api.withpersona.com/api/v1/inquiries", {
              method:"POST",
              headers:requestHeaders,
              signal:controller.signal,
              body:JSON.stringify({
                data:{
                  attributes:{
                    "inquiry-template-id":personaInquiryTemplateId,
                    ...(profile.omitReferenceId?{}:{"reference-id":String(requestId)}),
                    fields:profile.fields
                  }
                }
              })
            });
            personaData = await personaResponse.json().catch(() => ({}));
          }catch(error){
            const state=personaFetchState(error);
            await env.DB.prepare("UPDATE persona_verification_attempts SET transaction_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(state.code,attempt.id).run();
            await logVerificationActivity(env,clientId,audit.id,"persona_transport_error","Persona request did not complete",state.message);
            return Response.json({ok:false,code:state.code,message:state.message,retry_allowed:false,refresh_recommended:true},{status:state.code==="persona_timeout"?504:503});
          }finally{clearTimeout(timeout);}

          finalPersonaRequestId=personaResponse.headers.get("Request-Id") || "";
          if(personaResponse.ok){
            acceptedProfile=profile.name;
            break;
          }

          const personaError=personaData?.errors?.[0]||{};
          lastErrorDetail=String(personaError.detail||personaError.title||personaData?.message||"Persona rejected the verification request.");
          const isGenericBadRequest=personaResponse.status===400&&/^bad request$/i.test(lastErrorDetail.trim());
          const mayRetryWithFewerFields=personaResponse.status===400&&profileIndex<uniqueProfiles.length-1&&isGenericBadRequest;
          if(mayRetryWithFewerFields)continue;
          break;
        }

        if (!personaResponse.ok) {
          const personaError = personaData?.errors?.[0] || {};
          const personaRequestId = finalPersonaRequestId;
          let detail = personaError.detail || personaError.title || personaData?.message || lastErrorDetail || "Persona rejected the verification request.";
          const errorPointer=String(personaError?.source?.pointer || personaError?.meta?.field || "");
          const attemptedFields=Object.keys(uniqueProfiles.at(-1)?.fields||snakeInquiryFields||{});
          if (personaResponse.status === 400 && /^bad request$/i.test(String(detail).trim())) {
            detail = /^persona_sandbox_/i.test(String(env.PERSONA_API_KEY||""))
              ? "Persona rejected the inquiry even after ClearPath sent the exact documented Sandbox quickstart format. The API key is valid, so the configured Inquiry Template is likely not available in this Sandbox environment or is not the template Persona Support configured for the inquiry-created workflow."
              : "Persona rejected the prefilled inquiry after ClearPath tried both current snake_case and legacy kebab-case field names, including a minimal identity-only field set.";
          }
          if(errorPointer) detail += " Field: " + errorPointer + ".";
          if(attemptedFields.length) detail += " Final attempted fields: " + attemptedFields.join(", ") + ".";
          const personaEnvironmentId=personaResponse.headers.get("Persona-Environment-Id")||"";
          if(personaEnvironmentId)detail += " Persona environment: "+personaEnvironmentId+".";
          if (personaRequestId) detail += " Persona request: " + personaRequestId + ".";
          console.error("Persona inquiry create failed:", personaResponse.status);
          await env.DB.prepare("UPDATE persona_verification_attempts SET transaction_status='request_failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(attempt.id).run();
          await logVerificationActivity(env, clientId, audit.id, "persona_error", "Persona submission failed", "Persona rejected the request after adaptive prefill retries. Technical details were not stored in the audit log.");
          const sandboxTemplateMismatch=
            personaResponse.status===400 &&
            /^persona_sandbox_/i.test(String(env.PERSONA_API_KEY||"")) &&
            acceptedProfile==="" &&
            uniqueProfiles.at(-1)?.name==="persona_docs_workflow_safe";
          return Response.json({
            ok:false,
            code:sandboxTemplateMismatch?"persona_template_environment_mismatch":"persona_request_rejected",
            message:sandboxTemplateMismatch
              ? "Persona setup needs attention before another verification can be submitted."
              : "Persona could not complete this verification request. Manual verification remains available.",
            technical_details:String(detail),
            retry_allowed:!sandboxTemplateMismatch,
            configuration_error:sandboxTemplateMismatch,
            persona_environment_id:personaResponse.headers.get("Persona-Environment-Id")||"",
            inquiry_template_id:personaInquiryTemplateId
          },{status:personaResponse.status >= 500 ? 502 : personaResponse.status});
        }

        if(acceptedProfile){
          await logVerificationActivity(env,clientId,audit.id,"persona_prefill_profile","Persona accepted prefill profile","Profile: "+acceptedProfile);
        }

        const transaction = personaData?.data || {};
        const transactionId = String(transaction?.id || "");
        const transactionStatus = String(transaction?.attributes?.status || "created").toLowerCase();
        await env.DB.prepare("UPDATE persona_verification_attempts SET transaction_id=?,transaction_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(transactionId,transactionStatus,attempt.id).run();
        await env.DB.prepare(`
          UPDATE client_verification_audits
          SET persona_transaction_id=?,
              persona_transaction_status=?,
              persona_submitted_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE COALESCE(persona_submitted_at,CURRENT_TIMESTAMP) END,
              persona_updated_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).bind(transactionId, transactionStatus, forceNewPersona ? 1 : 0, audit.id).run();
        await logVerificationActivity(env, clientId, audit.id, "persona_submitted", forceNewPersona ? "New Persona test inquiry created" : (data.retry_persona ? "Persona inquiry retried" : "Persona inquiry created"), "Inquiry recorded"+(forceNewPersona&&existingPersonaId ? " · Previous inquiry preserved: "+existingPersonaId : "")+(addressComplete ? " · Address supplied" : " · Address unavailable — ID details used instead"));
        await logVerificationActivity(env, clientId, audit.id, "persona_response", "Persona response received", "Status: " + transactionStatus);

        const updated = await env.DB.prepare(`
          SELECT id, client_id, date_request_id, accepted, authorization_wording,
                 authorization_version, accepted_at, verification_status,
                 verification_method, submitted_employer, submitted_job_title,
                 submitted_industry, identity_confirmed, employer_confirmed,
                 job_title_confirmed, industry_confirmed, contact_confirmed,
                 evidence_notes, decision_reason, decision_notes, birthdate, completed_by, review_flag,
                 persona_transaction_id, persona_transaction_status, persona_submitted_at, persona_updated_at, completed_at, updated_at
          FROM client_verification_audits WHERE id=? LIMIT 1
        `).bind(audit.id).first();

        return Response.json({
          ok:true,
          message:transactionStatus === "approved"
            ? "Persona returned Approved. Review the manual checklist and choose the final decision."
            : "Persona status: " + transactionStatus.replaceAll("_"," ") + ". Manual verification remains the final decision.",
          transaction_id:transactionId,
          transaction_status:transactionStatus,
          record:verificationAuditPublicRecord(updated)
        }, {headers:{"Cache-Control":"private, no-store"}});
      } catch(error) {
        console.error("Persona admin verification error:", error);
        return Response.json({ok:false,message:"Persona could not complete this verification request. Manual verification remains available.",technical_details:String(error?.message || error),retry_allowed:true},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/persona-refresh" && request.method === "POST") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const config=await fetchPersonaInquiryTemplateConfig(env);
        if(!config.ok)return Response.json({ok:false,message:config.message,technical_details:config.technical_details},{status:config.state==="invalid_credentials"?401:config.state==="incorrect_inquiry_template"?400:502});
        const data=await request.json().catch(()=>({}));
        const clientId=Number(data.client_id);
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});
        const actor=accessIdentity(request).email||"admin";
        const rate=await enforceVerificationRateLimit(env,"persona_refresh",actor+":"+clientId,20,300);
        if(!rate.ok)return Response.json({ok:false,code:"rate_limited",message:"Too many Persona status refreshes. Try again shortly."},{status:429,headers:{"Retry-After":String(rate.retry_after)}});
        const audit=await env.DB.prepare(
          "SELECT * FROM client_verification_audits WHERE client_id=? AND persona_transaction_id<>'' ORDER BY persona_submitted_at DESC, id DESC LIMIT 1"
        ).bind(clientId).first();
        if(!audit)return Response.json({ok:false,message:"No Persona inquiry is available to refresh."},{status:404});
        const headers={Authorization:"Bearer "+String(env.PERSONA_API_KEY),"Key-Inflection":"snake"};
        if(env.PERSONA_API_VERSION)headers["Persona-Version"]=String(env.PERSONA_API_VERSION);
        const response=await fetch("https://api.withpersona.com/api/v1/inquiries/"+encodeURIComponent(audit.persona_transaction_id),{headers});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok){
          const detail=payload?.errors?.[0]?.detail||payload?.errors?.[0]?.title||payload?.message||"Persona could not refresh this inquiry.";
          return Response.json({ok:false,message:"Unable to refresh Persona status.",technical_details:String(detail)},{status:response.status===404?404:502});
        }
        const newStatus=String(payload?.data?.attributes?.status||"").toLowerCase()||String(audit.persona_transaction_status||"pending");
        await env.DB.prepare("UPDATE client_verification_audits SET persona_transaction_status=?, persona_updated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(newStatus,audit.id).run();
        await env.DB.prepare("UPDATE persona_verification_attempts SET transaction_status=?,last_refreshed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=?")
          .bind(newStatus,audit.persona_transaction_id).run();
        await logVerificationActivity(env,clientId,audit.id,"persona_refresh","Persona status refreshed","Status: "+newStatus);
        const updated=await env.DB.prepare("SELECT * FROM client_verification_audits WHERE id=? LIMIT 1").bind(audit.id).first();
        return Response.json({ok:true,message:"Persona status refreshed.",transaction_status:newStatus,record:verificationAuditPublicRecord(updated)},{headers:{"Cache-Control":"private, no-store"}});
      } catch(error) {
        console.error("Persona status refresh error:",error);
        return Response.json({ok:false,message:"Unable to refresh Persona status.",technical_details:String(error?.message||error)},{status:500});
      }
    }

    if (url.pathname === "/api/admin/clients/persona-workflow-result" && request.method === "POST") {
      try {
        await ensureVerificationWorkspaceTables(env);
        const config=await fetchPersonaInquiryTemplateConfig(env);
        if(!config.ok)return Response.json({ok:false,message:config.message,technical_details:config.technical_details},{status:config.state==="invalid_credentials"?401:config.state==="incorrect_inquiry_template"?400:502});

        const data=await request.json().catch(()=>({}));
        const clientId=Number(data.client_id);
        if(!await requireIdDocumentClient(env,clientId))return Response.json({ok:false,message:"Client not found."},{status:404});

        const actor=accessIdentity(request).email||"admin";
        const rate=await enforceVerificationRateLimit(env,"persona_workflow_result",actor+":"+clientId,20,300);
        if(!rate.ok)return Response.json({ok:false,code:"rate_limited",message:"Too many Persona workflow checks. Try again shortly."},{status:429,headers:{"Retry-After":String(rate.retry_after)}});

        const audit=await env.DB.prepare(
          "SELECT * FROM client_verification_audits WHERE client_id=? AND persona_transaction_id<>'' ORDER BY persona_submitted_at DESC, id DESC LIMIT 1"
        ).bind(clientId).first();
        if(!audit)return Response.json({ok:false,message:"No Persona inquiry is available to inspect."},{status:404});

        const headers={Authorization:"Bearer "+String(env.PERSONA_API_KEY),"Key-Inflection":"snake"};
        if(env.PERSONA_API_VERSION)headers["Persona-Version"]=String(env.PERSONA_API_VERSION);

        const inquiryId=String(audit.persona_transaction_id||"");
        const personaResponse=await fetch(
          "https://api.withpersona.com/api/v1/inquiries/"+encodeURIComponent(inquiryId)+"?include=verifications",
          {headers}
        );
        const personaPayload=await personaResponse.json().catch(()=>({}));
        if(!personaResponse.ok){
          const detail=personaPayload?.errors?.[0]?.detail||personaPayload?.errors?.[0]?.title||personaPayload?.message||"Persona could not inspect this inquiry.";
          return Response.json({
            ok:false,
            message:"Unable to check Persona workflow result.",
            technical_details:String(detail),
            persona_request_id:personaResponse.headers.get("Request-Id")||""
          },{status:personaResponse.status===404?404:502});
        }

        const inquiryStatus=String(personaPayload?.data?.attributes?.status||audit.persona_transaction_status||"created").toLowerCase();
        const inquiryFields=personaPayload?.data?.attributes?.fields&&typeof personaPayload.data.attributes.fields==="object"
          ? personaPayload.data.attributes.fields
          : {};
        const personaDiagnosticFieldValue=value=>{
          if(value===undefined||value===null)return "";
          if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return String(value);
          if(typeof value==="object"){
            for(const key of ["value","raw","text","code","country_code","country-code"]){
              const nested=value?.[key];
              if(nested!==undefined&&nested!==null&&typeof nested!=="object")return String(nested);
            }
          }
          return "";
        };
        const countryFieldDiagnostics={
          selected_country_code:personaDiagnosticFieldValue(
            inquiryFields.selected_country_code ??
            inquiryFields["selected-country-code"]
          ),
          address_country_code:personaDiagnosticFieldValue(
            inquiryFields.address_country_code ??
            inquiryFields["address-country-code"]
          )
        };
        const included=Array.isArray(personaPayload?.included)?personaPayload.included:[];
        const verifications=included.filter(item=>String(item?.type||"").startsWith("verification/"));
        const createdMs=item=>{
          const raw=item?.attributes?.created_at||item?.attributes?.["created-at"]||"";
          const ms=raw?Date.parse(raw):0;
          return Number.isFinite(ms)?ms:0;
        };
        verifications.sort((a,b)=>createdMs(b)-createdMs(a));
        const isDatabaseVerification=item=>{
          const type=String(item?.type||"").toLowerCase();
          return type==="verification/database" ||
            type.startsWith("verification/database-") ||
            type==="verification/aamva";
        };
        const databaseVerifications=verifications.filter(isDatabaseVerification);
        const latestDatabase=databaseVerifications[0]||null;

        // Inspect the inquiry.created Event first, then match Workflow Runs by creator event.
        // Persona's workflow-run.created payload links a run to the event that created it.
        let matchedWorkflowRun=null;
        let matchedWorkflow=null;
        let matchedTriggerEvent=null;
        let workflowLookupError="";
        let workflowRequestId="";
        let eventLookupError="";
        let eventRequestId="";
        const workflowHeaders={...headers};

        const eventMatchesInquiry=event=>{
          const attrs=event?.attributes||{};
          const eventName=String(attrs.name||"").toLowerCase();
          const payload=attrs?.payload?.data||attrs?.payload||{};
          const payloadId=String(payload?.id||payload?.data?.id||"");
          return eventName==="inquiry.created" && payloadId===inquiryId;
        };

        try{
          const eventsResponse=await fetch(
            "https://api.withpersona.com/api/v1/events?page%5Bsize%5D=100",
            {headers:workflowHeaders}
          );
          eventRequestId=eventsResponse.headers.get("Request-Id")||"";
          const eventsPayload=await eventsResponse.json().catch(()=>({}));
          if(eventsResponse.ok){
            const events=Array.isArray(eventsPayload?.data)?eventsPayload.data:[];
            matchedTriggerEvent=events.find(eventMatchesInquiry)||null;
          }else{
            const detail=eventsPayload?.errors?.[0]?.detail||eventsPayload?.errors?.[0]?.title||eventsPayload?.message||"Persona could not list events.";
            eventLookupError=String(detail);
          }
        }catch(error){
          eventLookupError=String(error?.message||error);
        }

        try{
          const workflowListResponse=await fetch(
            "https://api.withpersona.com/api/v1/workflow-runs?page%5Bsize%5D=100",
            {headers:workflowHeaders}
          );
          workflowRequestId=workflowListResponse.headers.get("Request-Id")||"";
          const workflowListPayload=await workflowListResponse.json().catch(()=>({}));
          if(workflowListResponse.ok){
            const runs=Array.isArray(workflowListPayload?.data)?workflowListPayload.data:[];
            if(matchedTriggerEvent){
              const eventId=String(matchedTriggerEvent.id||"");
              matchedWorkflowRun=runs.find(run=>String(run?.relationships?.creator?.data?.id||"")===eventId)||null;
            }

            // Fallback for Persona responses that omit creator relationship data:
            // match a recent run created immediately after this inquiry's creation.
            if(!matchedWorkflowRun){
              const inquiryCreatedAt=String(personaPayload?.data?.attributes?.created_at||personaPayload?.data?.attributes?.["created-at"]||"");
              const inquiryCreatedMs=inquiryCreatedAt?Date.parse(inquiryCreatedAt):0;
              const candidates=runs.filter(run=>{
                const runCreated=String(run?.attributes?.created_at||run?.attributes?.["created-at"]||"");
                const runMs=runCreated?Date.parse(runCreated):0;
                if(!inquiryCreatedMs||!runMs)return false;
                const delta=runMs-inquiryCreatedMs;
                return delta>=-5000 && delta<=120000;
              });
              if(candidates.length===1)matchedWorkflowRun=candidates[0];
            }

            if(matchedWorkflowRun){
              const workflowId=String(matchedWorkflowRun?.relationships?.workflow?.data?.id||"");
              if(workflowId){
                try{
                  const wfResponse=await fetch(
                    "https://api.withpersona.com/api/v1/workflows/"+encodeURIComponent(workflowId),
                    {headers:workflowHeaders}
                  );
                  const wfPayload=await wfResponse.json().catch(()=>({}));
                  if(wfResponse.ok)matchedWorkflow=wfPayload?.data||null;
                }catch(_error){}
              }
            }
          }else{
            const detail=workflowListPayload?.errors?.[0]?.detail||workflowListPayload?.errors?.[0]?.title||workflowListPayload?.message||"Persona could not list workflow runs.";
            workflowLookupError=String(detail);
          }
        }catch(error){
          workflowLookupError=String(error?.message||error);
        }

        let workflowRunDiagnostics={};
        if(matchedWorkflowRun){
          const runId=String(matchedWorkflowRun.id||"");
          if(runId){
            try{
              const detailResponse=await fetch(
                "https://api.withpersona.com/api/v1/workflow-runs/"+encodeURIComponent(runId),
                {headers:workflowHeaders}
              );
              const detailPayload=await detailResponse.json().catch(()=>({}));
              if(detailResponse.ok && detailPayload?.data){
                matchedWorkflowRun=detailPayload.data;
                const attrs=detailPayload.data?.attributes||{};
                const meta=detailPayload.data?.meta||{};
                const safeKeys=["status","error","errors","error_message","error-message","message","failure_reason","failure-reason","step","step_name","step-name"];
                const safe={};
                for(const key of safeKeys){
                  if(attrs[key]!==undefined&&attrs[key]!==null&&attrs[key]!=="")safe[key]=attrs[key];
                  if(meta[key]!==undefined&&meta[key]!==null&&meta[key]!=="")safe["meta_"+key]=meta[key];
                }
                workflowRunDiagnostics=safe;
              }
            }catch(_error){}
          }
        }

        const workflowRunAttrs=matchedWorkflowRun?.attributes||{};
        const workflowRunStatus=String(workflowRunAttrs.status||"").toLowerCase();
        const workflowRunState=matchedWorkflowRun
          ? (workflowRunStatus==="errored"?"errored":workflowRunStatus==="completed"?"completed":workflowRunStatus||"triggered")
          : "not_triggered";
        const workflowRunCreatedAt=String(workflowRunAttrs.created_at||workflowRunAttrs["created-at"]||"");
        const workflowRunCompletedAt=String(workflowRunAttrs.completed_at||workflowRunAttrs["completed-at"]||"");

        const attrs=latestDatabase?.attributes||{};
        const databaseStatus=String(attrs.status||"").toLowerCase();
        const completedAt=String(attrs.completed_at||attrs["completed-at"]||"");
        const createdAt=String(attrs.created_at||attrs["created-at"]||"");
        const submittedAt=String(attrs.submitted_at||attrs["submitted-at"]||"");
        const terminalStatuses=new Set(["passed","failed","requires_retry","confirmed","canceled","skipped"]);
        const runningStatuses=new Set(["initiated","submitted","pending","processing"]);
        let workflowState="not_run";
        if(latestDatabase){
          workflowState=terminalStatuses.has(databaseStatus)?"completed":runningStatuses.has(databaseStatus)?"running":"ran";
        }

        const checkList=Array.isArray(attrs.checks)?attrs.checks:[];
        const checkSummary=checkList.map(check=>({
          name:String(check?.name||check?.type||check?.attributes?.name||""),
          status:String(check?.status||check?.attributes?.status||"")
        })).filter(check=>check.name||check.status).slice(0,20);

        await logVerificationActivity(
          env,clientId,audit.id,"persona_workflow_check","Persona workflow result checked",
          latestDatabase
            ? "Database verification "+String(latestDatabase.id||"")+" · "+(databaseStatus||"status unavailable")
            : matchedWorkflowRun
              ? "Workflow run "+String(matchedWorkflowRun.id||"")+" · "+(workflowRunStatus||"status unavailable")+" · no Database verification attached"
              : "No matching workflow run or Database verification attached to inquiry "+inquiryId
        );

        return Response.json({
          ok:true,
          inquiry_id:inquiryId,
          inquiry_status:inquiryStatus,
          inquiry_country_fields:countryFieldDiagnostics,
          database_ran:Boolean(latestDatabase),
          workflow_state:workflowState,
          database_verification:latestDatabase ? {
            id:String(latestDatabase.id||""),
            type:String(latestDatabase.type||""),
            status:databaseStatus||"unknown",
            created_at:createdAt,
            submitted_at:submittedAt,
            completed_at:completedAt,
            checks:checkSummary
          } : null,
          verification_count:verifications.length,
          database_verification_count:databaseVerifications.length,
          trigger_event:matchedTriggerEvent ? {
            id:String(matchedTriggerEvent.id||""),
            name:String(matchedTriggerEvent?.attributes?.name||"inquiry.created"),
            created_at:String(matchedTriggerEvent?.attributes?.created_at||matchedTriggerEvent?.attributes?.["created-at"]||"")
          } : null,
          workflow_run:matchedWorkflowRun ? {
            id:String(matchedWorkflowRun.id||""),
            status:workflowRunStatus||"unknown",
            state:workflowRunState,
            created_at:workflowRunCreatedAt,
            completed_at:workflowRunCompletedAt,
            workflow_id:String(matchedWorkflowRun?.relationships?.workflow?.data?.id||""),
            workflow_name:String(matchedWorkflow?.attributes?.name||"ClearPath - Inquiry Created - Database Verification"),
            diagnostics:workflowRunDiagnostics
          } : null,
          workflow_triggered:Boolean(matchedWorkflowRun),
          workflow_state:latestDatabase ? workflowState : workflowRunState,
          message:latestDatabase
            ? "Database (US) verification found for this Persona inquiry."
            : matchedWorkflowRun
              ? (workflowRunStatus==="errored"
                  ? "The ClearPath Persona workflow triggered but errored before a Database (US) verification was attached."
                  : "The ClearPath Persona workflow triggered, but no Database (US) verification is attached yet.")
              : "No ClearPath workflow run was found for this inquiry.",
          technical_details:latestDatabase
            ? ""
            : matchedWorkflowRun
              ? (workflowRunStatus==="errored"
                  ? "Persona reports the workflow run as errored. Open the matching Workflow Run in Persona using the Workflow Run ID to inspect the failing step."
                  : "Persona reports that the workflow triggered. Database (US) has not been attached to the inquiry yet.")
              : (eventLookupError
                  ? "ClearPath could not inspect Persona Events: "+eventLookupError
                  : !matchedTriggerEvent
                    ? "Persona did not return an inquiry.created event for this inquiry in the current environment."
                    : workflowLookupError
                      ? "The inquiry.created event exists, but ClearPath could not inspect Persona Workflow Runs: "+workflowLookupError
                      : "Persona created the inquiry.created event, but no Workflow Run was linked to that event. The workflow trigger or environment/template scope needs attention."),
          event_request_id:eventRequestId,
          workflow_request_id:workflowRequestId,
          persona_request_id:personaResponse.headers.get("Request-Id")||"",
          persona_environment_id:personaResponse.headers.get("Persona-Environment-Id")||""
        },{headers:{"Cache-Control":"private, no-store"}});
      } catch(error) {
        console.error("Persona workflow result error:",error);
        return Response.json({ok:false,message:"Unable to check Persona workflow result.",technical_details:String(error?.message||error)},{status:500});
      }
    }

    // =========================================================
    // IDENTITY VERIFICATION WEBHOOK (Persona)
    // =========================================================
    if (url.pathname === "/api/webhooks/persona" && request.method === "POST") {
      try {
        const rawBody = await request.text();
        await ensureVerificationWorkspaceTables(env);
        await env.DB.prepare("UPDATE persona_webhook_health SET last_received_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
        const signature = request.headers.get("Persona-Signature") || "";
        const verified = await verifyPersonaWebhookSignature(rawBody, signature, env.PERSONA_WEBHOOK_SECRET);
        if (!verified) {
          await env.DB.prepare("UPDATE persona_webhook_health SET last_rejected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
          return Response.json({ok:false,message:"Invalid webhook signature."},{status:401});
        }

        const event = JSON.parse(rawBody || "{}");
        const eventId=String(event?.data?.id || event?.id || "").trim();
        const eventName = String(event?.data?.attributes?.name || event?.type || "").toLowerCase();
        const payload = event?.data?.attributes?.payload?.data || event?.data?.attributes?.payload || event?.data || {};
        const attrs = payload?.attributes || {};
        const objectId = String(payload?.id || attrs?.["inquiry-id"] || "");
        const referenceId = String(attrs?.["reference-id"] || attrs?.reference_id || "").trim();
        const objectStatus = String(attrs?.status || "").toLowerCase();

        await ensureVerificationWorkspaceTables(env);
        if(eventId){
          const inserted=await env.DB.prepare(
            "INSERT OR IGNORE INTO persona_webhook_events (event_id,event_type,transaction_id,resulting_status,received_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)"
          ).bind(eventId,eventName,objectId,objectStatus).run();
          if(!Number(inserted.meta?.changes||0))return Response.json({ok:true,duplicate:true,event_id:eventId});
        }

        let verificationStatus = "";
        let identityConfirmed = 0;
        let transactionStatus = "";

        if (eventName.includes("transaction.status-updated")) {
          transactionStatus = objectStatus;
          if (objectStatus === "approved") {
            verificationStatus = "verified";
            identityConfirmed = 1;
          } else if (["declined","errored"].includes(objectStatus)) {
            verificationStatus = "unable_to_verify";
          } else if (["created","needs_review","pending_fallback_inquiry"].includes(objectStatus)) {
            verificationStatus = "pending_review";
          } else {
            return Response.json({ok:true,ignored:true,reason:"unhandled_transaction_status"});
          }
        } else if (
          eventName.includes("inquiry.completed") ||
          eventName.includes("inquiry.approved") ||
          objectStatus === "completed" ||
          objectStatus === "approved"
        ) {
          transactionStatus = objectStatus || "completed";
          verificationStatus = "verified";
          identityConfirmed = 1;
        } else if (
          eventName.includes("inquiry.failed") ||
          eventName.includes("inquiry.declined") ||
          objectStatus === "failed" ||
          objectStatus === "declined"
        ) {
          transactionStatus = objectStatus || "failed";
          verificationStatus = "unable_to_verify";
        } else {
          return Response.json({ok:true,ignored:true});
        }

        const requestId = Number(referenceId);
        if (!Number.isInteger(requestId) || requestId < 1) {
          console.warn("Persona webhook missing valid booking request reference ID:", referenceId, objectId);
          return Response.json({ok:true,ignored:true,reason:"missing_reference_id"});
        }

        const audit = await env.DB.prepare(
          "SELECT id, client_id FROM client_verification_audits WHERE date_request_id=? LIMIT 1"
        ).bind(requestId).first();
        if (!audit) {
          console.warn("Persona webhook has no matching verification audit:", requestId, objectId);
          return Response.json({ok:true,ignored:true,reason:"audit_not_found"});
        }

        await env.DB.prepare(`
          UPDATE client_verification_audits
          SET persona_transaction_id=CASE WHEN ?<>'' THEN ? ELSE persona_transaction_id END,
              persona_transaction_status=CASE WHEN ?<>'' THEN ? ELSE persona_transaction_status END,
              persona_updated_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
          WHERE date_request_id=?
        `).bind(
          transactionStatus,
          transactionStatus ? objectId : "",
          transactionStatus,
          transactionStatus,
          requestId
        ).run();
        await logVerificationActivity(
          env,
          Number(audit.client_id),
          Number(audit.id),
          "persona_response",
          "Persona response received",
          "Status: " + (transactionStatus || objectStatus) + (eventId ? " · Event: " + eventId : "")
        );
        if(eventId){
          await env.DB.prepare("UPDATE persona_webhook_events SET transaction_id=?, resulting_status=? WHERE event_id=?")
            .bind(objectId,transactionStatus||objectStatus,eventId).run();
        }
        if(objectId){
          await env.DB.prepare("UPDATE persona_verification_attempts SET transaction_status=?,last_refreshed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=?")
            .bind(transactionStatus||objectStatus,objectId).run();
        }
        await env.DB.prepare("UPDATE persona_webhook_health SET last_success_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();

        return Response.json({
          ok:true,
          booking_request_id:requestId,
          status:"persona_updated",
          persona_status:transactionStatus || objectStatus
        });
      } catch(error) {
        console.error("Persona webhook error:",error);
        return Response.json({ok:false,message:"Unable to process verification webhook."},{status:500});
      }
    }

    // =========================================================
    // EMAIL ENGAGEMENT WEBHOOK (Resend)
    // =========================================================
    if (url.pathname === "/api/webhooks/resend" && request.method === "POST") {
      try {
        const event = await request.json();
        const type = String(event?.type || "");
        const providerId = String(event?.data?.email_id || event?.data?.id || "");
        if (!providerId) return Response.json({ok:true,ignored:true});
        const tracked = await env.DB.prepare("SELECT email_draft_id FROM email_tracking WHERE provider_email_id=? LIMIT 1").bind(providerId).first();
        if (!tracked) return Response.json({ok:true,ignored:true});
        if (type === "email.opened") {
          await env.DB.prepare(`
            UPDATE email_tracking SET
              opened_at=COALESCE(opened_at,CURRENT_TIMESTAMP),
              last_opened_at=CURRENT_TIMESTAMP,
              open_count=COALESCE(open_count,0)+1,
              updated_at=CURRENT_TIMESTAMP
            WHERE email_draft_id=?
          `).bind(tracked.email_draft_id).run();
        }
        return Response.json({ok:true});
      } catch(error) {
        console.error("Resend webhook error:",error);
        return Response.json({ok:false},{status:500});
      }
    }

    // Mark a sent email as responded when the client replies outside the dashboard.
    if (url.pathname.match(/^\/api\/admin\/email-drafts\/\d+\/responded$/) && request.method === "POST") {
      const draftId=Number(url.pathname.split("/").slice(-2,-1)[0]);
      if(!Number.isInteger(draftId)||draftId<1) return Response.json({ok:false,message:"Invalid email ID."},{status:400});
      await env.DB.prepare(`
        INSERT INTO email_tracking (email_draft_id, responded_at, updated_at)
        VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(email_draft_id) DO UPDATE SET responded_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      `).bind(draftId).run();
      return Response.json({ok:true});
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
        const dateTypeMatch = notesText.match(/Date type:\s*([^\n]+)/i);
        const appointmentTypeMatch = notesText.match(/Appointment type:\s*([^\n]+)/i);
        const offerMatch = notesText.match(/Offer:\s*([\s\S]*?)(?=\n(?:Date type:|Appointment type:|Preferred contact|Outcall address:|Duration:|Request details:|Screening requirement|25% deposit)|$)/i);
        const specialRateMatch = offerMatch?.[1]?.match(/for\s+\$([\d,]+)/i);

        const durationKey = String(durationMatch?.[1] || "").trim().toLowerCase();
        const durationLabel = durationKey
          .replace(/-hours?$/, match => match === "-hour" ? " hour" : " hours");
        const dateTypeKey = String(dateTypeMatch?.[1] || "").trim().toLowerCase();
        const appointmentTypeKey = String(appointmentTypeMatch?.[1] || "").trim().toLowerCase();
        const specialRate = specialRateMatch
          ? Number(specialRateMatch[1].replace(/,/g, ""))
          : 0;

        const configuredServices = await readSiteRates(env);
        const serviceNameByDateType = {
          "private-introduction": "private introductions",
          "private-uncovered-introduction": "private introductions",
          "signature-brief-introduction": "brief experiences",
          "greek-princess-brief-introduction": "brief experiences",
          "signature-girlfriend-experience": "signature girlfriend experience",
          "greek-princess-experience": "greek princess experience"
        };
        const selectedService = configuredServices.find(service =>
          String(service.name || "").trim().toLowerCase() === serviceNameByDateType[dateTypeKey]
        );
        const configuredRate = selectedService?.rates?.find(rate => {
          const label = String(rate?.[0] || "").trim().toLowerCase();
          if (dateTypeKey === "private-introduction") return label.startsWith("private introduction");
          if (dateTypeKey === "private-uncovered-introduction") return label.includes("private uncovered introduction");
          if (dateTypeKey === "signature-brief-introduction") return label.includes("signature brief introduction");
          if (dateTypeKey === "greek-princess-brief-introduction") return label.includes("greek princess brief introduction");
          return siteDurationMinutes(label) === siteDurationMinutes(durationKey);
        });
        const standardBookingRate = Number(configuredRate?.[1]) || 0;
        const outcallService = configuredServices.find(service =>
          service.add_on || String(service.name || "").trim().toLowerCase() === "outcall"
        );
        const configuredOutcallRate = Number(outcallService?.rates?.[0]?.[1]) || 100;
        const outcallAddOn = appointmentTypeKey === "outcall" ? configuredOutcallRate : 0;
        const bookingRate = (specialRate || standardBookingRate) + outcallAddOn;
        const baseDepositAmount = bookingRate > 0
          ? Math.round(bookingRate * 0.25 * 100) / 100
          : 0;
        const depositPaymentMethod = String(notesText.match(/Deposit payment method:\s*([^\n]+)/i)?.[1] || "gift-card").trim().toLowerCase();
        const depositProcessingRate = ["stripe", "crypto"].includes(depositPaymentMethod) ? 0.10 : 0;
        const depositProcessingFee = Math.round(baseDepositAmount * depositProcessingRate * 100) / 100;
        const depositAmount = Math.round((baseDepositAmount + depositProcessingFee) * 100) / 100;

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

To complete final approval, please reply directly to this email with your ID attached and complete your ${depositDisplay} deposit.

In your reply, please also tell me the industry you currently work in.

You selected: ${depositPaymentMethod === "gift-card" ? "Gift Card" : depositPaymentMethod === "stripe" ? "Stripe" : "Crypto"}.
${depositProcessingFee > 0 ? `Your deposit request includes the 10% payment processing fee (${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(depositProcessingFee)}).` : "No processing fee is added for Gift Card deposits."}

${depositPaymentMethod === "crypto"
  ? "Crypto payment instructions: Please use the crypto payment information provided with this email and reply with your ID attached."
  : depositPaymentMethod === "stripe"
    ? "Stripe payment instructions: Please use the Stripe payment request provided with this email and reply with your ID attached."
    : "Gift Card payment instructions: Please follow the gift card payment instructions provided with this email and reply with your ID attached."}

Please complete both the deposit and ID screening no later than 4 hours before our scheduled date and time.

Once I have both your ID and deposit, I'll personally review everything and confirm our date.

Kendra`
          ).run();
        }

        return Response.json({
          ok: true,
          message: "Request moved forward.",
          status: "pending_final_approval",
          deposit_amount: depositAmount,
          booking_rate: bookingRate,
          base_deposit_amount: baseDepositAmount,
          processing_fee: depositProcessingFee,
          deposit_payment_method: depositPaymentMethod
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
    // CALCULATE / REPAIR DEPOSIT
    // ============================================================
    if (url.pathname === "/api/admin/request/calculate-deposit" && request.method === "POST") {
      try {
        const data=await request.json();
        const requestId=Number(data.id);
        if(!Number.isInteger(requestId)||requestId<1) return Response.json({ok:false,message:"Invalid request ID."},{status:400});
        const item=await env.DB.prepare("SELECT id, deposit_amount, notes FROM date_requests WHERE id=? LIMIT 1").bind(requestId).first();
        if(!item) return Response.json({ok:false,message:"Request not found."},{status:404});
        if(Number(item.deposit_amount||0)>0) return Response.json({ok:true,deposit_amount:Number(item.deposit_amount)});

        const notes=String(item.notes||"");
        const dateTypeKey=(notes.match(/Date type:\s*([^\n]+)/i)?.[1]||"").trim().toLowerCase();
        const appointmentTypeKey=(notes.match(/Appointment type:\s*([^\n]+)/i)?.[1]||"").trim().toLowerCase();
        const durationKey=(notes.match(/Duration:\s*([^\n]+)/i)?.[1]||"").trim().toLowerCase().replace(/-/g," ");
        const specialRateMatch=notes.match(/Selected monthly special:[^\n]*?\bat\s*\$([\d,]+(?:\.\d{1,2})?)/i);
        const specialRate=specialRateMatch?Number(specialRateMatch[1].replace(/,/g,"")):0;
        const configuredServices=await readSiteRates(env);
        const aliases={
          "private-introduction":"private introductions","private-uncovered-introduction":"private introductions",
          "signature-brief-introduction":"brief experiences","greek-princess-brief-introduction":"brief experiences",
          "signature-girlfriend-experience":"signature girlfriend experience","signature-private-companionship":"signature girlfriend experience",
          "signature-experience":"signature girlfriend experience","greek-princess-experience":"greek princess experience",
          "greek-private-companionship":"greek princess experience"
        };
        const selectedService=configuredServices.find(service=>String(service.name||"").trim().toLowerCase()===aliases[dateTypeKey]);
        const configuredRate=selectedService?.rates?.find(rate=>{
          const label=String(rate?.[0]||"").trim().toLowerCase();
          if(dateTypeKey==="private-introduction")return label.startsWith("private introduction");
          if(dateTypeKey==="private-uncovered-introduction")return label.includes("private uncovered introduction");
          if(dateTypeKey==="signature-brief-introduction")return label.includes("signature brief introduction");
          if(dateTypeKey==="greek-princess-brief-introduction")return label.includes("greek princess brief introduction");
          return siteDurationMinutes(label)===siteDurationMinutes(durationKey);
        });
        const standardRate=Number(configuredRate?.[1])||0;
        const outcallService=configuredServices.find(service=>service.add_on||String(service.name||"").trim().toLowerCase()==="outcall");
        const outcallAddOn=appointmentTypeKey==="outcall"?(Number(outcallService?.rates?.[0]?.[1])||100):0;
        const bookingRate=(specialRate||standardRate)+outcallAddOn;
        const depositAmount=bookingRate>0?Math.round(bookingRate*.25*100)/100:0;
        if(depositAmount<=0)return Response.json({ok:false,message:"Unable to match this request to a current rate."},{status:400});
        await env.DB.prepare("UPDATE date_requests SET deposit_amount=? WHERE id=?").bind(depositAmount,requestId).run();
        return Response.json({ok:true,deposit_amount:depositAmount,booking_rate:bookingRate});
      } catch(error) {
        console.error("Calculate deposit error:",error);
        return Response.json({ok:false,message:"Unable to calculate deposit."},{status:500});
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
        // Older/in-flight requests may have reached final approval before a
        // deposit amount was stored. Recalculate it from the same rate source used
        // by Move Forward so an already-sent request is not permanently stuck.
        let depositAmount = Number(item.deposit_amount || 0);
        if (depositAmount <= 0) {
          const notes = String(item.notes || "");
          const dateTypeKey = (notes.match(/Date type:\s*([^\n]+)/i)?.[1] || "").trim().toLowerCase();
          const appointmentTypeKey = (notes.match(/Appointment type:\s*([^\n]+)/i)?.[1] || "").trim().toLowerCase();
          const durationKey = (notes.match(/Duration:\s*([^\n]+)/i)?.[1] || "").trim().toLowerCase().replace(/-/g, " ");
          const specialRateMatch = notes.match(/Selected monthly special:[^\n]*?\bat\s*\$([\d,]+(?:\.\d{1,2})?)/i);
          const specialRate = specialRateMatch ? Number(specialRateMatch[1].replace(/,/g, "")) : 0;
          const configuredServices = await readSiteRates(env);
          const serviceNameByDateType = {
            "private-introduction": "private introductions",
            "private-uncovered-introduction": "private introductions",
            "signature-brief-introduction": "brief experiences",
            "greek-princess-brief-introduction": "brief experiences",
            "signature-girlfriend-experience": "signature girlfriend experience",
            "signature-private-companionship": "signature girlfriend experience",
            "signature-experience": "signature girlfriend experience",
            "greek-princess-experience": "greek princess experience",
            "greek-private-companionship": "greek princess experience"
          };
          const selectedService = configuredServices.find(service =>
            String(service.name || "").trim().toLowerCase() === serviceNameByDateType[dateTypeKey]
          );
          const configuredRate = selectedService?.rates?.find(rate => {
            const label = String(rate?.[0] || "").trim().toLowerCase();
            if (dateTypeKey === "private-introduction") return label.startsWith("private introduction");
            if (dateTypeKey === "private-uncovered-introduction") return label.includes("private uncovered introduction");
            if (dateTypeKey === "signature-brief-introduction") return label.includes("signature brief introduction");
            if (dateTypeKey === "greek-princess-brief-introduction") return label.includes("greek princess brief introduction");
            return siteDurationMinutes(label) === siteDurationMinutes(durationKey);
          });
          const standardBookingRate = Number(configuredRate?.[1]) || 0;
          const outcallService = configuredServices.find(service =>
            service.add_on || String(service.name || "").trim().toLowerCase() === "outcall"
          );
          const outcallAddOn = appointmentTypeKey === "outcall" ? (Number(outcallService?.rates?.[0]?.[1]) || 100) : 0;
          const bookingRate = (specialRate || standardBookingRate) + outcallAddOn;
          depositAmount = bookingRate > 0 ? Math.round(bookingRate * 0.25 * 100) / 100 : 0;
          if (depositAmount > 0) {
            await env.DB.prepare("UPDATE date_requests SET deposit_amount = ? WHERE id = ?").bind(depositAmount, requestId).run();
            item.deposit_amount = depositAmount;
          } else {
            return Response.json({ ok:false, message:"Unable to calculate the deposit from this request. Verify the selected experience and duration." }, { status:400 });
          }
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
      dr.location_address,
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

if (approvedRequest) {
  // Availability is derived from daily work hours. Do not delete schedule rows.
  // The booking engine excludes every final-approved appointment by its full duration,
  // so the occupied block becomes unavailable immediately while the surrounding
  // work-day hours remain bookable.
  await ensureSiteContentTables(env);
}

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
${approvedRequest.location_address ? `Address: ${approvedRequest.location_address}\n` : ""}
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
    // PRIVATE PORTAL ROUTING
    // =========================================================

    const legacyPortalRoutes = new Map([
      ["/admin", "/portal"],
      ["/admin.html", "/portal"],
      ["/admin-request", "/portal/request"],
      ["/admin-request.html", "/portal/request"],
      ["/admin-emails", "/portal/emails"],
      ["/admin-emails.html", "/portal/emails"]
    ]);

    if (legacyPortalRoutes.has(url.pathname)) {
      const destination = new URL(request.url);
      destination.pathname = legacyPortalRoutes.get(url.pathname);
      return Response.redirect(destination.toString(), 302);
    }

    // =========================================================
    // SERVE THE EXISTING WEBSITE
    // =========================================================

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname === "/portal" || url.pathname.startsWith("/portal/")) {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
    return assetResponse;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await runVerificationRetention(env);
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
