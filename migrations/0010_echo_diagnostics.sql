CREATE TABLE IF NOT EXISTS echo_diagnostics (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  piece_id TEXT NOT NULL,
  score_version_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  audio_size INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  consented_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(member_id, piece_id)
);
CREATE INDEX IF NOT EXISTS echo_diagnostics_expiry ON echo_diagnostics(expires_at);
CREATE TABLE IF NOT EXISTS echo_diagnostic_cleanup (
  object_key TEXT PRIMARY KEY,
  delete_after TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS echo_diagnostics_replace
AFTER UPDATE OF object_key ON echo_diagnostics WHEN OLD.object_key <> NEW.object_key
BEGIN
  INSERT OR IGNORE INTO echo_diagnostic_cleanup VALUES(OLD.object_key, datetime('now'));
END;
CREATE TRIGGER IF NOT EXISTS echo_diagnostics_delete AFTER DELETE ON echo_diagnostics
BEGIN
  INSERT OR IGNORE INTO echo_diagnostic_cleanup VALUES(OLD.object_key, datetime('now'));
END;
