-- Store terms acceptance as a separate auditable record without changing
-- existing request columns or booking/screening tables.
-- Apply only after the introduction request has been created successfully.
CREATE TABLE IF NOT EXISTS introduction_terms_acceptances (
  request_id INTEGER PRIMARY KEY,
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES date_requests(id)
);
CREATE INDEX IF NOT EXISTS idx_introduction_terms_accepted_at
  ON introduction_terms_acceptances (accepted_at);
