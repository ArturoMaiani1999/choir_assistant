CREATE TABLE IF NOT EXISTS authorization_audit (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  target_member_id TEXT NOT NULL,
  event TEXT NOT NULL,
  details_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS authorization_audit_choir_time
  ON authorization_audit(choir_id, recorded_at DESC);

