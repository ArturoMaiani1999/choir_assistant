ALTER TABLE authorized_members ADD COLUMN preferred_voice_part TEXT
  CHECK (preferred_voice_part IS NULL OR preferred_voice_part IN ('soprano','contralto','tenore','basso'));
