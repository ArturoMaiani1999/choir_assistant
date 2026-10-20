ALTER TABLE authorized_members ADD COLUMN voice_part TEXT;

CREATE TABLE IF NOT EXISTS member_terms_acceptance (
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(member_id, terms_version)
);

CREATE TABLE IF NOT EXISTS repertoire_assignments (
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  piece_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  assigned_by TEXT NOT NULL REFERENCES authorized_members(member_id),
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(choir_id, piece_id)
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  piece_id TEXT NOT NULL,
  score_version_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  voice_part TEXT NOT NULL CHECK(voice_part IN ('soprano', 'contralto', 'tenore', 'basso')),
  started_from_beginning INTEGER NOT NULL CHECK(started_from_beginning IN (0, 1)),
  reached_end INTEGER NOT NULL CHECK(reached_end IN (0, 1)),
  completed INTEGER NOT NULL CHECK(completed IN (0, 1)),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  coverage REAL NOT NULL CHECK(coverage BETWEEN 0 AND 100),
  voiced_ms INTEGER NOT NULL CHECK(voiced_ms >= 0),
  playback_rate REAL NOT NULL CHECK(playback_rate BETWEEN 0.5 AND 1.5),
  transpose INTEGER NOT NULL CHECK(transpose BETWEEN -12 AND 12),
  trace_key TEXT,
  trace_etag TEXT,
  trace_size INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS practice_attempts_latest
  ON practice_attempts(choir_id, piece_id, voice_part, member_id, completed, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_attempts_expiry
  ON practice_attempts(expires_at);

CREATE TABLE IF NOT EXISTS member_piece_progress (
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  piece_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'ready')),
  first_practiced_at TEXT NOT NULL,
  last_practiced_at TEXT NOT NULL,
  last_completed_at TEXT,
  completion_count INTEGER NOT NULL DEFAULT 0 CHECK(completion_count >= 0),
  latest_score INTEGER NOT NULL CHECK(latest_score BETWEEN 0 AND 100),
  latest_coverage REAL NOT NULL CHECK(latest_coverage BETWEEN 0 AND 100),
  best_score INTEGER,
  best_coverage REAL,
  max_completed_speed REAL,
  PRIMARY KEY(choir_id, member_id, piece_id)
);

CREATE INDEX IF NOT EXISTS member_piece_progress_piece
  ON member_piece_progress(choir_id, piece_id, status, last_practiced_at DESC);

CREATE TABLE IF NOT EXISTS practice_attempt_object_cleanup (
  object_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS practice_attempts_queue_deleted_trace
AFTER DELETE ON practice_attempts
WHEN OLD.trace_key IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO practice_attempt_object_cleanup(object_key, queued_at)
  VALUES(OLD.trace_key, datetime('now'));
END;
