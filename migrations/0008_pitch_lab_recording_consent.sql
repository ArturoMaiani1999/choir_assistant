ALTER TABLE personal_recordings ADD COLUMN shared_for_analysis INTEGER NOT NULL DEFAULT 0
  CHECK(shared_for_analysis IN (0, 1));
ALTER TABLE personal_recordings ADD COLUMN analysis_consented_at TEXT;

CREATE INDEX IF NOT EXISTS personal_recordings_analysis_lookup
  ON personal_recordings(choir_id, piece_id, shared_for_analysis, updated_at DESC);
