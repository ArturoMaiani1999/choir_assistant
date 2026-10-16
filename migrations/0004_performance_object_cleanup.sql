CREATE TABLE IF NOT EXISTS performance_object_cleanup (
  image_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS best_performances_queue_replaced_image
AFTER UPDATE OF image_key ON best_performances
WHEN OLD.image_key <> NEW.image_key
BEGIN
  INSERT OR IGNORE INTO performance_object_cleanup(image_key, queued_at)
  VALUES(OLD.image_key, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS best_performances_queue_deleted_image
AFTER DELETE ON best_performances
BEGIN
  INSERT OR IGNORE INTO performance_object_cleanup(image_key, queued_at)
  VALUES(OLD.image_key, datetime('now'));
END;

