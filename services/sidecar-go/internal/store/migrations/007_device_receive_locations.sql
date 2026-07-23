CREATE INDEX IF NOT EXISTS uploads_client_status_completed_idx
ON uploads (client_id, status);

CREATE TABLE IF NOT EXISTS device_receive_locations (
  client_id    TEXT NOT NULL,
  path         TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (client_id, path)
);

CREATE TABLE IF NOT EXISTS device_receive_location_backfills (
  client_id TEXT PRIMARY KEY
);
