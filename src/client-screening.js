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
  const report = {
    version:1, source, checked_at:new Date().toISOString(),
    name:{status:client.first_name && client.last_name?"provided":"incomplete"},
    email:{status:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?"format_valid":"invalid", ownership:"not_verified"},
    phone:{status:phone.length>=10 && phone.length<=15?"format_plausible":"needs_review", ownership:"not_verified", carrier:"not_checked"},
    occupation:{status:occupation.trim()?"self_reported":"not_provided", employer:"not_verified"},
    previous_requests:Number(duplicates?.count||0),
    internal_blacklist:{status:blocked?"potential_match":"no_match"},
    recommendation:"manual_review_required",
    final_approval:"unchanged"
  };
  await env.DB.prepare(`INSERT INTO client_screening_runs(date_request_id,client_id,source,report_json) VALUES(?,?,?,?)`)
    .bind(id,client.client_id,source,JSON.stringify(report)).run();
  return report;
}
