CREATE TABLE IF NOT EXISTS device_blocks (
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  failed_attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TEXT,
  manually_unblocked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (desktop_device_id, client_id)
);

CREATE TABLE IF NOT EXISTS connection_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  result TEXT NOT NULL,
  failure_reason TEXT,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connection_attempts_device_client
  ON connection_attempts(desktop_device_id, client_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS shared_resources (
  resource_id TEXT PRIMARY KEY,
  desktop_device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  local_path TEXT,
  received_file_key TEXT,
  file_size INTEGER,
  media_type TEXT,
  status TEXT NOT NULL,
  added_at TEXT NOT NULL,
  removed_at TEXT,
  last_accessed_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shared_resources_desktop_status
  ON shared_resources(desktop_device_id, status, added_at DESC);

CREATE TABLE IF NOT EXISTS access_records (
  record_id TEXT PRIMARY KEY,
  desktop_device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  accessed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_records_desktop_accessed
  ON access_records(desktop_device_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_records_client_accessed
  ON access_records(desktop_device_id, client_id, accessed_at DESC);
