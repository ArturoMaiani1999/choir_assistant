CREATE TABLE IF NOT EXISTS personal_recordings (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  piece_id TEXT NOT NULL,
  score_version_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  audio_key TEXT NOT NULL UNIQUE,
  audio_etag TEXT NOT NULL,
  audio_size INTEGER NOT NULL CHECK(audio_size > 0),
  audio_type TEXT NOT NULL,
  pitch_key TEXT NOT NULL UNIQUE,
  pitch_etag TEXT NOT NULL,
  pitch_size INTEGER NOT NULL CHECK(pitch_size > 0),
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  audio_offset_ms INTEGER NOT NULL CHECK(audio_offset_ms >= 0),
  playback_rate REAL NOT NULL CHECK(playback_rate BETWEEN 0.5 AND 1.5),
  transpose INTEGER NOT NULL CHECK(transpose BETWEEN -12 AND 12),
  consented_at TEXT NOT NULL,
  headphones_confirmed INTEGER NOT NULL CHECK(headphones_confirmed = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(member_id, piece_id)
);

CREATE INDEX IF NOT EXISTS personal_recordings_member_updated
  ON personal_recordings(member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS recording_object_cleanup (
  object_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS personal_recordings_queue_replaced_objects
AFTER UPDATE OF audio_key, pitch_key ON personal_recordings
WHEN OLD.audio_key <> NEW.audio_key OR OLD.pitch_key <> NEW.pitch_key
BEGIN
  INSERT OR IGNORE INTO recording_object_cleanup(object_key, queued_at)
  VALUES(OLD.audio_key, datetime('now'));
  INSERT OR IGNORE INTO recording_object_cleanup(object_key, queued_at)
  VALUES(OLD.pitch_key, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS personal_recordings_queue_deleted_objects
AFTER DELETE ON personal_recordings
BEGIN
  INSERT OR IGNORE INTO recording_object_cleanup(object_key, queued_at)
  VALUES(OLD.audio_key, datetime('now'));
  INSERT OR IGNORE INTO recording_object_cleanup(object_key, queued_at)
  VALUES(OLD.pitch_key, datetime('now'));
END;
