-- Store acceptance on the introduction request itself.
-- Apply once, before deploying the Worker integration.
ALTER TABLE date_requests ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE date_requests ADD COLUMN terms_version TEXT;
