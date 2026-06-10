CREATE TABLE IF NOT EXISTS pairing_attempts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id         TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  client_name       TEXT,
  device_alias      TEXT,
  platform          TEXT,
  stable_device_id  TEXT,
  ip                TEXT,
  result            TEXT NOT NULL,
  failure_reason    TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_rate_limits (
  client_id         TEXT NOT NULL,
  desktop_device_id TEXT NOT NULL,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  first_failed_at   TEXT NOT NULL,
  last_failed_at    TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (client_id, desktop_device_id)
);

CREATE TABLE IF NOT EXISTS blocked_pairing_clients (
  client_id          TEXT NOT NULL,
  desktop_device_id  TEXT NOT NULL,
  client_name        TEXT,
  device_alias       TEXT,
  platform           TEXT,
  stable_device_id   TEXT,
  last_ip            TEXT,
  failed_attempts    INTEGER NOT NULL,
  blocked_at         TEXT NOT NULL,
  last_attempt_at    TEXT NOT NULL,
  reason             TEXT NOT NULL,
  cleared_at         TEXT,
  cleared_by         TEXT,
  PRIMARY KEY (client_id, desktop_device_id, blocked_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS blocked_pairing_clients_active_unique
ON blocked_pairing_clients (client_id, desktop_device_id)
WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS pairing_attempts_recent_idx
ON pairing_attempts (created_at DESC);

CREATE INDEX IF NOT EXISTS pairing_attempts_client_desktop_idx
ON pairing_attempts (client_id, desktop_device_id, created_at DESC);
