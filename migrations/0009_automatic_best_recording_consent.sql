CREATE TABLE IF NOT EXISTS member_recording_preferences (
  member_id TEXT PRIMARY KEY REFERENCES authorized_members(member_id),
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  automatic_best_recording INTEGER NOT NULL DEFAULT 0
    CHECK(automatic_best_recording IN (0, 1)),
  consented_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS member_recording_preferences_choir
  ON member_recording_preferences(choir_id, automatic_best_recording);
