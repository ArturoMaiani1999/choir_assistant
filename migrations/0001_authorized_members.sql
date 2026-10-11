CREATE TABLE IF NOT EXISTS authorized_members (
  email_digest TEXT PRIMARY KEY CHECK(length(email_digest) = 64),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS authorized_members_active
  ON authorized_members(active, email_digest);
