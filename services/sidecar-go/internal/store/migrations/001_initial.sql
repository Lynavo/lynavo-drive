CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paired_devices (
  client_id           TEXT PRIMARY KEY,
  client_name         TEXT NOT NULL,
  device_alias        TEXT,
  last_ip             TEXT,
  platform            TEXT NOT NULL,
  pairing_id          TEXT NOT NULL,
  pairing_token_hash  TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  revoked_at          TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  client_name     TEXT NOT NULL,
  state           TEXT NOT NULL,
  active_file_key TEXT,
  active_offset   INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  file_key              TEXT PRIMARY KEY,
  session_id            TEXT,
  client_id             TEXT NOT NULL,
  original_filename     TEXT NOT NULL,
  media_type            TEXT NOT NULL,
  file_size             INTEGER NOT NULL,
  created_at_remote     TEXT,
  modified_at_remote    TEXT,
  status                TEXT NOT NULL,
  part_path             TEXT,
  final_path            TEXT,
  committed_bytes       INTEGER NOT NULL DEFAULT 0,
  sha256                TEXT,
  active_transmission_ms INTEGER NOT NULL DEFAULT 0,
  completed_at          TEXT,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_daily_stats (
  stat_date             TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  client_name_snapshot  TEXT NOT NULL,
  client_ip_snapshot    TEXT,
  file_count            INTEGER NOT NULL DEFAULT 0,
  total_bytes           INTEGER NOT NULL DEFAULT 0,
  active_transmission_ms INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (stat_date, client_id)
);

CREATE TABLE IF NOT EXISTS share_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  receive_root      TEXT NOT NULL,
  share_name        TEXT NOT NULL,
  share_url         TEXT NOT NULL,
  share_status      TEXT NOT NULL,
  last_validated_at TEXT,
  last_error        TEXT
);

-- Default seeds
INSERT OR IGNORE INTO settings (key, value) VALUES ('connection_code', '000000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('device_id', lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))));
INSERT OR IGNORE INTO settings (key, value) VALUES ('device_name', '');
INSERT OR IGNORE INTO share_config (id, receive_root, share_name, share_url, share_status)
  VALUES (1, '', 'Vivi Drop', '', 'unknown');
