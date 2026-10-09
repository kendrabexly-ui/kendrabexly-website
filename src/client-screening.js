// Screening checks are informational only; never change approval status.
// No external background/identity searches are performed without a separately
// configured lawful provider and explicit consent.
export async function runInitialScreening(env, requestId, source = "automatic") {
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid request ID");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_screening_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_request_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const client = await env.DB.prepare(`
    SELECT dr.id AS request_id,dr.client_id,c.first_name,c.last_name,c.email,c.phone,dr.notes
    FROM date_requests dr JOIN clients c ON c.id=dr.client_id WHERE dr.id=?
  `).bind(id).first();
  if (!client) throw new Error("Request not found");
  const email = String(client.email || "").trim().toLowerCase();
  const phone = String(client.phone || "").replace(/\D/g,"");
  const occupation = (String(client.notes || "").match(/^Occupation:\s*(.*)$/m)||[])[1] || "";
  const [blocked, duplicates] = await Promise.all([
    env.DB.prepare(`SELECT id FROM blacklist WHERE client_id=? OR LOWER(email)=? OR REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),'(',''),')',''),' ','')=? LIMIT 1`).bind(client.client_id,email,phone).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM date_requests WHERE client_id=? AND id<>?`).bind(client.client_id,id).first()
  ]);
  // Reuse evidence already saved by the protected verification workspace.
  // Never initiate billable or legally restricted third-party searches here.
  let lineCheck=null, credentialCheck=null, recordCheck=null;
  try {
    [lineCheck,credentialCheck,recordCheck]=await Promise.all([
      env.DB.prepare("SELECT phone_e164,valid,line_type,carrier_name,is_voip,checked_at FROM client_phone_line_checks WHERE client_id=? LIMIT 1").bind(client.client_id).first(),
      env.DB.prepare("SELECT credential_status,source_name,source_url,checked_at FROM client_credential_verifications WHERE client_id=? LIMIT 1").bind(client.client_id).first(),
      env.DB.prepare("SELECT record_status,source_name,source_url,checked_at,public_records_reviewed,criminal_records_reviewed FROM client_public_record_checks WHERE client_id=? LIMIT 1").bind(client.client_id).first()
    ]);
  } catch {
    // Existing deployments without the optional workspace tables stay manual-review only.
  }
  const submittedDigits=phone.replace(/\\D/g,"");
  const verifiedDigits=String(lineCheck?.phone_e164||"").replace(/\\D/g,"");
  const samePhone=Boolean(submittedDigits && verifiedDigits && (
    submittedDigits===verifiedDigits ||
    (submittedDigits.length===10 && verifiedDigits==="1"+submittedDigits) ||
    (verifiedDigits.length===10 && submittedDigits==="1"+verifiedDigits)
  ));
  const savedLine=samePhone && lineCheck?.checked_at ? lineCheck : null;
  const savedLicense=credentialCheck?.checked_at && credentialCheck?.source_name ? credentialCheck : null;
  const savedRecords=recordCheck?.checked_at && recordCheck?.source_name ? recordCheck : null;
  const recordEvidence=(reviewed)=>reviewed && savedRecords
    ? {status:"reviewed",source_url:savedRecords.source_url||null,provider:savedRecords.source_name,checked_at:savedRecords.checked_at,result:savedRecords.record_status||"needs_review"}
    : {status:"not_checked",source_url:null,provider:"none"};
  const report = {
    version:2, source, checked_at:new Date().toISOString(),
    name:{status:client.first_name && client.last_name?"provided":"incomplete"},
    email:{status:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?"format_valid":"invalid", ownership:"not_verified"},
    phone:{status:phone.length>=10 && phone.length<=15?"format_plausible":"needs_review", ownership:"not_verified", carrier:"not_checked", twilio:{status:savedLine?(Number(savedLine.valid)===1 && savedLine.line_type && savedLine.line_type!=="unknown"?"checked":"inconclusive"):"not_configured", line_type:savedLine?.line_type||"not_checked", voip:savedLine?(Number(savedLine.is_voip)===1?"yes":"no_or_unknown"):"not_checked", lookup_at:savedLine?.checked_at||null, provider:"Twilio Lookup"}},
    occupation:{status:occupation.trim()?"self_reported":"not_provided", employer:"not_verified"},
    previous_requests:Number(duplicates?.count||0),
    internal_blacklist:{status:blocked?"potential_match":"no_match"},
    external_sources:{
      status:"not_connected",
      explanation:"No authorized external records provider is configured. Public profile discovery is not proof of identity.",
      government_records:{status:"not_checked",source_url:null},
      id_records:{status:"not_checked",source_url:null,provider:"none",note:"ID document review does not establish a government database match."},
      public_records:recordEvidence(Number(savedRecords?.public_records_reviewed)===1),
      criminal_records:{...recordEvidence(Number(savedRecords?.criminal_records_reviewed)===1),note:"Requires lawful access, applicable notice/consent and individual review; do not infer guilt from record hits."},
      court_and_docket_indexes:{status:"not_checked",source_url:null,provider:"none"},
      professional_licenses:{status:savedLicense?.credential_status||"not_checked",source_url:savedLicense?.source_url||null,provider:savedLicense?.source_name||"none",checked_at:savedLicense?.checked_at||null},
      professional_credentials:{status:"not_checked",source_url:null,provider:"none",note:"Check directly with the relevant issuing institution or authoritative registry."},
      business_registration:{status:"not_checked",source_url:null},
      public_professional_profiles:{status:"not_checked",source_url:null},
      public_social_profiles:{status:"not_checked",source_url:null},
      social_email_registration:{status:"not_verifiable",explanation:"Social platforms do not provide a reliable authorized public email-account registration lookup."}
    },
    required_follow_up:["Confirm email ownership using a one-time link","Confirm phone ownership using a one-time code","Review official issuing-agency license and credential registries when applicable","Review public and court index sources only when legally appropriate and authorized"],
    recommendation:"manual_review_required",
    final_approval:"unchanged"
  };
  await env.DB.prepare(`INSERT INTO client_screening_runs(date_request_id,client_id,source,report_json) VALUES(?,?,?,?)`)
    .bind(id,client.client_id,source,JSON.stringify(report)).run();
  return report;
}
