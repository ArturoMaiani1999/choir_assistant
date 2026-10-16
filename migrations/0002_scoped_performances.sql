CREATE TABLE IF NOT EXISTS choirs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO choirs(id, slug, name, active, created_at, updated_at)
VALUES('choir_primary', 'primary', 'Coro', 1, datetime('now'), datetime('now'));

ALTER TABLE authorized_members ADD COLUMN member_id TEXT;
ALTER TABLE authorized_members ADD COLUMN choir_id TEXT;
ALTER TABLE authorized_members ADD COLUMN clerk_subject TEXT;
ALTER TABLE authorized_members ADD COLUMN display_name TEXT;

UPDATE authorized_members
SET member_id = COALESCE(member_id, 'm_' || substr(email_digest, 1, 32)),
    choir_id = COALESCE(choir_id, 'choir_primary'),
    display_name = COALESCE(display_name, 'Corista ' || substr(email_digest, 1, 8));

CREATE UNIQUE INDEX IF NOT EXISTS authorized_members_member_id
  ON authorized_members(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS authorized_members_clerk_subject
  ON authorized_members(clerk_subject) WHERE clerk_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS authorized_members_choir_email
  ON authorized_members(choir_id, email_digest);

CREATE TABLE IF NOT EXISTS choir_groups (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(choir_id, code)
);

CREATE TABLE IF NOT EXISTS group_memberships (
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  group_id TEXT NOT NULL REFERENCES choir_groups(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id, group_id)
);

CREATE TABLE IF NOT EXISTS member_roles (
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  role TEXT NOT NULL CHECK(role IN ('singer', 'section_viewer', 'director', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(member_id, role)
);

CREATE TABLE IF NOT EXISTS performance_view_grants (
  viewer_member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  group_id TEXT NOT NULL REFERENCES choir_groups(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(viewer_member_id, group_id)
);

CREATE TABLE IF NOT EXISTS best_performances (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id),
  member_id TEXT NOT NULL REFERENCES authorized_members(member_id),
  piece_id TEXT NOT NULL,
  score_version_id TEXT NOT NULL,
  part_id TEXT NOT NULL,
  scoring_profile TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  coverage REAL NOT NULL CHECK(coverage BETWEEN 0 AND 100),
  image_key TEXT NOT NULL UNIQUE,
  image_etag TEXT NOT NULL,
  image_size INTEGER NOT NULL CHECK(image_size > 0),
  created_at TEXT NOT NULL,
  improved_at TEXT NOT NULL,
  UNIQUE(member_id, piece_id, score_version_id, part_id, scoring_profile)
);

CREATE INDEX IF NOT EXISTS group_memberships_group_active
  ON group_memberships(group_id, active, member_id);
CREATE INDEX IF NOT EXISTS performance_view_grants_viewer_active
  ON performance_view_grants(viewer_member_id, active, group_id);
CREATE INDEX IF NOT EXISTS member_roles_member_active
  ON member_roles(member_id, active, role);
CREATE INDEX IF NOT EXISTS best_performances_member
  ON best_performances(member_id, improved_at DESC);
CREATE INDEX IF NOT EXISTS best_performances_choir
  ON best_performances(choir_id, improved_at DESC);

