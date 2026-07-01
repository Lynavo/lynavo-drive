import Foundation
import SQLite3

// MARK: - Model Structs

struct BindingRecord {
    let deviceId: String
    var deviceName: String
    var deviceAlias: String?
    let deviceType: String
    var host: String
    let port: Int
    let pairingId: String
    let pairingTokenKeychainRef: String
    var shareName: String?
    let lastBoundAt: String
    var wake: WakeCapability?
}

struct StoredBinding {
    let serverId: String
    let sidecarHost: String
    let port: Int
    let pairingTokenKeychainRef: String
}

struct UploadItemRecord {
    let id: Int64?
    let assetLocalId: String
    let modifiedAt: String
    let mediaType: String
    var originalFilename: String?
    var fileKey: String?
    var fileSize: Int64?
    var status: String  // MobileUploadItemStatus values: discovered, preparing, ready, cloud_downloading, uploading, completed, failed, skipped, cancelled
    var ackedOffset: Int64
    var lastErrorCode: String?
    let updatedAt: String
    var source: String  // 'auto' | 'manual'
    var batchId: String?
    var priority: Int  // 0 = auto (default), 1 = manual (higher priority)
    var sourceKind: String = "photo"
    var sourceFilePath: String? = nil
    var mimeType: String? = nil
}

struct AutoUploadConfigRecord {
    var enabled: Bool
    // media_filter column remains in SQLite but is no longer used — auto upload uploads everything
    var timeRangeMode: String  // 'from_now' | 'from_today' | 'all' | 'custom'
    var customTimeFrom: String?
    var state: String  // 'disabled' | 'active' | 'interrupted' — persisted source of truth
    var updatedAt: String
}

struct SessionRecord {
    let sessionId: String
    let startedAt: String
    var endedAt: String?
    var state: String
    let queueTotalCount: Int
    let queueTotalBytes: Int64
    var completedCount: Int
    var completedBytes: Int64
    var activeFileKey: String?
    var activeOffset: Int64
    var activeTransmissionMs: Int64
    let updatedAt: String
}

struct DailyLedgerRecord {
    let ledgerDate: String
    let deviceId: String
    let deviceNameSnapshot: String
    let deviceIpSnapshot: String
    let fileCount: Int
    let totalBytes: Int64
    let activeTransmissionMs: Int64
    let updatedAt: String
}

// MARK: - UploadStore

class UploadStore {
    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.lynavo.drive.uploadstore", qos: .userInitiated)

    init() throws {
        let dbPath = UploadStore.dbPath()
        let dir = (dbPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            let errmsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw SyncEngineError.databaseError("Failed to open database: \(errmsg)")
        }

        // Enable WAL mode for better concurrent read performance.
        // Use executeInternal directly during init — no concurrent access yet.
        try executeInternal("PRAGMA journal_mode=WAL")
        try migrateInternal()
    }

    deinit {
        if let db = db {
            sqlite3_close(db)
        }
    }

    static func dbPath() -> String {
        let libraryDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let appSupportDir = libraryDir.appendingPathComponent("Application Support", isDirectory: true)
        let newDBURL = appSupportDir.appendingPathComponent("lynavo-drive.db")
        
        let oldDocs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let oldDBURL = oldDocs.appendingPathComponent("lynavo-drive.db")
        
        if FileManager.default.fileExists(atPath: oldDBURL.path) && !FileManager.default.fileExists(atPath: newDBURL.path) {
            try? FileManager.default.createDirectory(at: appSupportDir, withIntermediateDirectories: true)
            
            let oldWalURL = oldDocs.appendingPathComponent("lynavo-drive.db-wal")
            let newWalURL = appSupportDir.appendingPathComponent("lynavo-drive.db-wal")
            let oldShmURL = oldDocs.appendingPathComponent("lynavo-drive.db-shm")
            let newShmURL = appSupportDir.appendingPathComponent("lynavo-drive.db-shm")
            
            try? FileManager.default.moveItem(at: oldDBURL, to: newDBURL)
            try? FileManager.default.moveItem(at: oldWalURL, to: newWalURL)
            try? FileManager.default.moveItem(at: oldShmURL, to: newShmURL)
            
            slog("[UploadStore] Migrated database files from Documents to Library/Application Support")
        }
        
        return newDBURL.path
    }

    // MARK: - Migration

    private func migrateInternal() throws {
        let sql = """
        CREATE TABLE IF NOT EXISTS binding (
          id                          INTEGER PRIMARY KEY CHECK (id = 1),
          device_id                   TEXT NOT NULL,
          device_name                 TEXT NOT NULL,
          device_alias                TEXT,
          device_type                 TEXT NOT NULL,
          host                        TEXT NOT NULL,
          port                        INTEGER NOT NULL,
          pairing_id                  TEXT NOT NULL,
          pairing_token_keychain_ref  TEXT NOT NULL,
          share_name                  TEXT,
          last_bound_at               TEXT NOT NULL,
          wake_metadata_json          TEXT
        );

        CREATE TABLE IF NOT EXISTS upload_items (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_local_id  TEXT NOT NULL,
          modified_at     TEXT NOT NULL DEFAULT '',
          media_type      TEXT NOT NULL,
          original_filename TEXT,
          file_key        TEXT,
          file_size       INTEGER,
          status          TEXT NOT NULL,
          acked_offset    INTEGER NOT NULL DEFAULT 0,
          last_error_code TEXT,
          updated_at      TEXT NOT NULL,
          UNIQUE(asset_local_id)
        );

        CREATE TABLE IF NOT EXISTS sync_sessions (
          session_id                TEXT PRIMARY KEY,
          started_at                TEXT NOT NULL,
          ended_at                  TEXT,
          state                     TEXT NOT NULL,
          queue_total_count         INTEGER NOT NULL,
          queue_total_bytes         INTEGER NOT NULL,
          completed_count           INTEGER NOT NULL DEFAULT 0,
          completed_bytes           INTEGER NOT NULL DEFAULT 0,
          active_file_key           TEXT,
          active_offset             INTEGER NOT NULL DEFAULT 0,
          active_transmission_ms    INTEGER NOT NULL DEFAULT 0,
          updated_at                TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_ledgers (
          ledger_date               TEXT NOT NULL,
          device_id                 TEXT NOT NULL,
          device_name_snapshot      TEXT NOT NULL,
          device_ip_snapshot        TEXT NOT NULL,
          file_count                INTEGER NOT NULL DEFAULT 0,
          total_bytes               INTEGER NOT NULL DEFAULT 0,
          active_transmission_ms    INTEGER NOT NULL DEFAULT 0,
          updated_at                TEXT NOT NULL,
          PRIMARY KEY (ledger_date, device_id)
        );

        CREATE TABLE IF NOT EXISTS upload_store_meta (
          key         TEXT PRIMARY KEY,
          value       TEXT,
          updated_at  TEXT NOT NULL
        );
        """
        try executeInternal(sql)

        // Migration: change UNIQUE(asset_local_id, modified_at) to UNIQUE(asset_local_id)
        // SQLite doesn't support ALTER UNIQUE, so recreate the table if old constraint exists
        let tableInfo = try queryInternal("SELECT sql FROM sqlite_master WHERE type='table' AND name='upload_items'", bind: [])
        if let createSQL = tableInfo.first?["sql"] as? String,
           createSQL.contains("UNIQUE(asset_local_id, modified_at)") {
            slog("[UploadStore] migrating upload_items: removing modified_at from UNIQUE constraint")
            try executeInternal("""
                CREATE TABLE upload_items_new (
                  id              INTEGER PRIMARY KEY AUTOINCREMENT,
                  asset_local_id  TEXT NOT NULL,
                  modified_at     TEXT NOT NULL DEFAULT '',
                  media_type      TEXT NOT NULL,
                  original_filename TEXT,
                  file_key        TEXT,
                  file_size       INTEGER,
                  status          TEXT NOT NULL,
                  acked_offset    INTEGER NOT NULL DEFAULT 0,
                  last_error_code TEXT,
                  updated_at      TEXT NOT NULL,
                  UNIQUE(asset_local_id)
                );
                INSERT OR REPLACE INTO upload_items_new SELECT * FROM upload_items;
                DROP TABLE upload_items;
                ALTER TABLE upload_items_new RENAME TO upload_items;
            """)
            slog("[UploadStore] migration complete")
        }

        // Migration: add source, batch_id, priority columns to upload_items (Lynavo Drive)
        let columnCheck = queryInternal(
            "SELECT COUNT(*) AS cnt FROM pragma_table_info('upload_items') WHERE name = 'source'",
            bind: []
        )
        let hasSourceColumn = (columnCheck.first?["cnt"] as? Int64 ?? 0) > 0
        if !hasSourceColumn {
            slog("[UploadStore] migrating upload_items: adding source, batch_id, priority columns")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN batch_id TEXT")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
            slog("[UploadStore] Lynavo Drive columns migration complete")
        }

        // Create auto_upload_config table (single-row config)
        try executeInternal("""
            CREATE TABLE IF NOT EXISTS auto_upload_config (
              id                INTEGER PRIMARY KEY CHECK (id = 1),
              enabled           INTEGER NOT NULL DEFAULT 0,
              media_filter      TEXT NOT NULL DEFAULT 'all',
              time_range_mode   TEXT NOT NULL DEFAULT 'all',
              custom_time_from  TEXT,
              state             TEXT NOT NULL DEFAULT 'disabled',
              updated_at        TEXT NOT NULL DEFAULT ''
            );
        """)

        // Migrate: add state column for existing databases that lack it
        let stateColumnCheck = queryInternal(
            "SELECT COUNT(*) AS cnt FROM pragma_table_info('auto_upload_config') WHERE name = 'state'",
            bind: []
        )
        let hasStateColumn = (stateColumnCheck.first?["cnt"] as? Int64 ?? 0) > 0
        if !hasStateColumn {
            slog("[UploadStore] migrating auto_upload_config: adding state column")
            try executeInternal("ALTER TABLE auto_upload_config ADD COLUMN state TEXT NOT NULL DEFAULT 'disabled'")
            // Backfill: if enabled=1, state should be 'active' (not 'disabled')
            try executeInternal("UPDATE auto_upload_config SET state = 'active' WHERE enabled = 1")
            slog("[UploadStore] auto_upload_config state column migration complete")
        }

        try addColumnIfMissing(table: "upload_items", column: "source_kind", definition: "TEXT NOT NULL DEFAULT 'photo'")
        try addColumnIfMissing(table: "upload_items", column: "source_file_path", definition: "TEXT")
        try addColumnIfMissing(table: "upload_items", column: "mime_type", definition: "TEXT")
        try addColumnIfMissing(table: "binding", column: "wake_metadata_json", definition: "TEXT")
    }

    private func addColumnIfMissing(table: String, column: String, definition: String) throws {
        let rows = queryInternal(
            "SELECT COUNT(*) AS cnt FROM pragma_table_info('\(table)') WHERE name = ?1",
            bind: [.text(column)]
        )
        let exists = (rows.first?["cnt"] as? Int64 ?? 0) > 0
        if !exists {
            try executeInternal("ALTER TABLE \(table) ADD COLUMN \(column) \(definition)")
        }
    }

    // MARK: - Binding CRUD

    func getBinding() -> BindingRecord? {
        return queue.sync {
            let sql = "SELECT device_id, device_name, device_alias, device_type, host, port, pairing_id, pairing_token_keychain_ref, share_name, last_bound_at, wake_metadata_json FROM binding WHERE id = 1"
            let rows = queryInternal(sql, bind: [])
            guard let row = rows.first else { return nil }
            return BindingRecord(
                deviceId: row["device_id"] as? String ?? "",
                deviceName: row["device_name"] as? String ?? "",
                deviceAlias: row["device_alias"] as? String,
                deviceType: row["device_type"] as? String ?? "",
                host: row["host"] as? String ?? "",
                port: Int(row["port"] as? Int64 ?? 0),
                pairingId: row["pairing_id"] as? String ?? "",
                pairingTokenKeychainRef: row["pairing_token_keychain_ref"] as? String ?? "",
                shareName: row["share_name"] as? String,
                lastBoundAt: row["last_bound_at"] as? String ?? "",
                wake: WakeCapability.decodeJSONString(row["wake_metadata_json"] as? String)
            )
        }
    }

    func saveBinding(_ binding: BindingRecord) throws {
        try queue.sync {
            let sql = """
            INSERT OR REPLACE INTO binding (id, device_id, device_name, device_alias, device_type, host, port, pairing_id, pairing_token_keychain_ref, share_name, last_bound_at, wake_metadata_json)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            """
            try executeWithBindings(sql, bindings: [
                .text(binding.deviceId),
                .text(binding.deviceName),
                .textOrNull(binding.deviceAlias),
                .text(binding.deviceType),
                .text(binding.host),
                .int(Int64(binding.port)),
                .text(binding.pairingId),
                .text(binding.pairingTokenKeychainRef),
                .textOrNull(binding.shareName),
                .text(binding.lastBoundAt),
                .textOrNull(binding.wake?.encodeJSONString())
            ])
        }
    }

    func clearBinding() throws {
        try queue.sync {
            try executeInternal("DELETE FROM binding")
        }
    }

    func resetAllStatusData() throws {
        try queue.sync {
            try executeInternal("DELETE FROM upload_items")
            try executeInternal("DELETE FROM sync_sessions")
            try executeInternal("DELETE FROM daily_ledgers")
        }
    }

    /// Clears the upload queue and in-progress sessions, but keeps daily_ledgers
    /// so historical stats are not lost. Use when switching to a different desktop device.
    func resetUploadQueue() throws {
        try queue.sync {
            try executeInternal("DELETE FROM upload_items")
            try executeInternal("DELETE FROM sync_sessions")
        }
    }

    // MARK: - Background Upload Metadata

    func getLastKnownBinding() -> StoredBinding? {
        return queue.sync {
            guard let serverId = getMetaValueInternal("last_known_binding_server_id"),
                  let sidecarHost = getMetaValueInternal("last_known_binding_sidecar_host"),
                  let portRaw = getMetaValueInternal("last_known_binding_port"),
                  let port = Int(portRaw),
                  let keychainRef = getMetaValueInternal("last_known_binding_pairing_token_keychain_ref") else {
                return nil
            }
            return StoredBinding(
                serverId: serverId,
                sidecarHost: sidecarHost,
                port: port,
                pairingTokenKeychainRef: keychainRef
            )
        }
    }

    func updateLastKnownBinding(_ binding: StoredBinding) throws {
        try queue.sync {
            try executeInternal("BEGIN IMMEDIATE TRANSACTION")
            do {
                try setMetaValueInternal("last_known_binding_server_id", value: binding.serverId)
                try setMetaValueInternal("last_known_binding_sidecar_host", value: binding.sidecarHost)
                try setMetaValueInternal("last_known_binding_port", value: String(binding.port))
                try setMetaValueInternal("last_known_binding_pairing_token_keychain_ref", value: binding.pairingTokenKeychainRef)
                try executeInternal("COMMIT")
            } catch {
                try? executeInternal("ROLLBACK")
                throw error
            }
        }
    }

    func currentBindingVersion() -> Int? {
        return queue.sync {
            guard let raw = getMetaValueInternal("binding_version") else { return nil }
            return Int(raw)
        }
    }

    @discardableResult
    func bumpBindingVersion() throws -> Int {
        try queue.sync {
            let current = Int(getMetaValueInternal("binding_version") ?? "0") ?? 0
            let next = current + 1
            try setMetaValueInternal("binding_version", value: String(next))
            return next
        }
    }

    // MARK: - Upload Items CRUD

    func upsertUploadItem(_ item: UploadItemRecord) throws {
        try queue.sync {
            try upsertUploadItemsInternal([item])
        }
    }

    func upsertUploadItems(_ items: [UploadItemRecord]) throws {
        guard !items.isEmpty else { return }
        try queue.sync {
            try upsertUploadItemsInternal(items)
        }
    }

    func getUploadItem(assetLocalId: String, modifiedAt: String) -> UploadItemRecord? {
        return queue.sync {
            let sql = "SELECT * FROM upload_items WHERE asset_local_id = ?1 AND modified_at = ?2"
            let rows = queryInternal(sql, bind: [.text(assetLocalId), .text(modifiedAt)])
            return rows.first.flatMap { uploadItemFromRow($0) }
        }
    }

    func getUploadItemByFileKey(_ fileKey: String) -> UploadItemRecord? {
        return queue.sync {
            let sql = "SELECT * FROM upload_items WHERE file_key = ?1"
            let rows = queryInternal(sql, bind: [.text(fileKey)])
            return rows.first.flatMap { uploadItemFromRow($0) }
        }
    }

    func getPendingUploadItems(limit: Int? = nil) -> [UploadItemRecord] {
        return queue.sync {
            var sql = "SELECT * FROM upload_items WHERE status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading') ORDER BY id ASC"
            if let limit = limit {
                sql += " LIMIT \(limit)"
            }
            let rows = queryInternal(sql, bind: [])
            return rows.compactMap { uploadItemFromRow($0) }
        }
    }

    func getQueueStats() -> (totalCount: Int, totalBytes: Int64, completedCount: Int, completedBytes: Int64) {
        return queue.sync {
            let sql = """
            SELECT 
                COUNT(*) AS total_count, 
                SUM(file_size) AS total_bytes,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END) AS completed_bytes
            FROM upload_items 
            WHERE status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading', 'completed')
            """
            let rows = queryInternal(sql, bind: [])
            guard let first = rows.first else {
                return (0, 0, 0, 0)
            }
            return (
                totalCount: Int(first["total_count"] as? Int64 ?? 0),
                totalBytes: first["total_bytes"] as? Int64 ?? 0,
                completedCount: Int(first["completed_count"] as? Int64 ?? 0),
                completedBytes: first["completed_bytes"] as? Int64 ?? 0
            )
        }
    }

    func getManualQueueStats(batchId: String) -> (totalCount: Int, totalBytes: Int64, completedCount: Int, completedBytes: Int64)? {
        guard !batchId.isEmpty else { return nil }
        return queue.sync {
            let statsSql = """
            SELECT
                COUNT(*) AS total_count,
                SUM(file_size) AS total_bytes,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN status = 'completed' THEN file_size ELSE 0 END) AS completed_bytes
            FROM upload_items
            WHERE source = 'manual'
              AND batch_id = ?1
              AND status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading', 'completed')
            """
            let rows = queryInternal(statsSql, bind: [.text(batchId)])
            guard let first = rows.first else {
                return nil
            }
            return (
                totalCount: Int(first["total_count"] as? Int64 ?? 0),
                totalBytes: first["total_bytes"] as? Int64 ?? 0,
                completedCount: Int(first["completed_count"] as? Int64 ?? 0),
                completedBytes: first["completed_bytes"] as? Int64 ?? 0
            )
        }
    }

    func getActiveManualQueueBatchId() -> String? {
        return queue.sync {
            let sql = """
            SELECT batch_id FROM upload_items
            WHERE source = 'manual'
              AND batch_id IS NOT NULL
              AND batch_id != ''
              AND status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading')
            ORDER BY priority DESC, id ASC
            LIMIT 1
            """
            let rows = queryInternal(sql, bind: [])
            return rows.first?["batch_id"] as? String
        }
    }

    func getCompletedFileKeys() -> [String] {
        return queue.sync {
            let sql = "SELECT file_key FROM upload_items WHERE status = 'completed' AND file_key IS NOT NULL"
            let rows = queryInternal(sql, bind: [])
            return rows.compactMap { $0["file_key"] as? String }
        }
    }

    func getTrackedFileKeys() -> [String] {
        return queue.sync {
            let sql = "SELECT file_key FROM upload_items WHERE file_key IS NOT NULL"
            let rows = queryInternal(sql, bind: [])
            return rows.compactMap { $0["file_key"] as? String }
        }
    }

    /// File keys that should suppress auto-discovery rescans.
    /// Completed items stay suppressed permanently; pending/in-flight items stay
    /// suppressed until they finish. Failed/skipped/cancelled items are excluded
    /// so a later auto-upload retry can re-queue them.
    func getAutoDiscoveryTrackedFileKeys() -> [String] {
        return queue.sync {
            let sql = """
            SELECT file_key FROM upload_items
            WHERE file_key IS NOT NULL
              AND status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading', 'completed')
            """
            let rows = queryInternal(sql, bind: [])
            return rows.compactMap { $0["file_key"] as? String }
        }
    }

    func updateUploadStatus(fileKey: String, status: String) throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = "UPDATE upload_items SET status = ?1, updated_at = ?2 WHERE file_key = ?3"
            try executeWithBindings(sql, bindings: [
                .text(status),
                .text(now),
                .text(fileKey)
            ])
        }
    }

    func updateUploadOffset(fileKey: String, offset: Int64) throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = "UPDATE upload_items SET acked_offset = ?1, updated_at = ?2 WHERE file_key = ?3"
            try executeWithBindings(sql, bindings: [
                .int(offset),
                .text(now),
                .text(fileKey)
            ])
        }
    }

    func resetUploadOffset(fileKey: String) throws {
        try updateUploadOffset(fileKey: fileKey, offset: 0)
    }

    func sweepOrphanUploadingOnStartup() throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = """
            UPDATE upload_items
            SET status = 'queued',
                acked_offset = 0,
                updated_at = ?1
            WHERE status = 'uploading'
            """
            try executeWithBindings(sql, bindings: [.text(now)])
        }
    }

    private func upsertUploadItemsInternal(_ items: [UploadItemRecord]) throws {
        let sql = """
        INSERT INTO upload_items (asset_local_id, modified_at, media_type, original_filename, file_key, file_size, status, acked_offset, last_error_code, updated_at, source, batch_id, priority, source_kind, source_file_path, mime_type)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(asset_local_id) DO UPDATE SET
          media_type = excluded.media_type,
          original_filename = excluded.original_filename,
          file_key = excluded.file_key,
          file_size = excluded.file_size,
          status = excluded.status,
          acked_offset = excluded.acked_offset,
          last_error_code = excluded.last_error_code,
          updated_at = excluded.updated_at,
          source = excluded.source,
          batch_id = excluded.batch_id,
          priority = excluded.priority,
          source_kind = excluded.source_kind,
          source_file_path = excluded.source_file_path,
          mime_type = excluded.mime_type
        """

        try executeInternal("BEGIN IMMEDIATE TRANSACTION")
        do {
            for item in items {
                try executeWithBindings(sql, bindings: [
                    .text(item.assetLocalId),
                    .text(item.modifiedAt),
                    .text(item.mediaType),
                    .textOrNull(item.originalFilename),
                    .textOrNull(item.fileKey),
                    .intOrNull(item.fileSize),
                    .text(item.status),
                    .int(item.ackedOffset),
                    .textOrNull(item.lastErrorCode),
                    .text(item.updatedAt),
                    .text(item.source),
                    .textOrNull(item.batchId),
                    .int(Int64(item.priority)),
                    .text(item.sourceKind),
                    .textOrNull(item.sourceFilePath),
                    .textOrNull(item.mimeType)
                ])
            }
            try executeInternal("COMMIT")
        } catch {
            try? executeInternal("ROLLBACK")
            throw error
        }
    }

    // MARK: - Priority-Sorted Pending Items

    /// Returns pending items sorted by priority DESC (manual first), then id ASC.
    /// This ensures manually selected items are uploaded before auto-scanned items.
    func getPendingUploadItemsSorted(limit: Int? = nil, excludeSource: String? = nil) -> [UploadItemRecord] {
        return queue.sync {
            var sql = """
            SELECT * FROM upload_items
            WHERE status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading', 'uploading')
            """
            var bindings: [BindingValue] = []
            if let excludeSource = excludeSource {
                sql += " AND source != ?1"
                bindings.append(.text(excludeSource))
            }
            sql += " ORDER BY priority DESC, id ASC"
            if let limit = limit {
                sql += " LIMIT \(limit)"
            }
            let rows = queryInternal(sql, bind: bindings)
            return rows.compactMap { uploadItemFromRow($0) }
        }
    }

    /// Count pending items split by source (auto vs manual).
    func getPendingCountsBySource() -> (auto: Int, manual: Int) {
        return queue.sync {
            let sql = """
            SELECT source, COUNT(*) as cnt FROM upload_items
            WHERE status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading')
            GROUP BY source
            """
            let rows = queryInternal(sql, bind: [])
            var autoCount = 0
            var manualCount = 0
            for row in rows {
                let source = row["source"] as? String ?? "auto"
                let count = (row["cnt"] as? Int64).map(Int.init) ?? 0
                if source == "manual" {
                    manualCount = count
                } else {
                    autoCount = count
                }
            }
            return (auto: autoCount, manual: manualCount)
        }
    }

    /// Get the source of the currently active upload item (if any).
    /// Checks all in-progress statuses, not just 'uploading', so that
    /// the task source is visible during preparing / cloud_downloading too.
    func getCurrentUploadingSource() -> String? {
        return queue.sync {
            let sql = """
            SELECT source FROM upload_items
            WHERE status IN ('uploading', 'preparing', 'cloud_downloading', 'ready')
            ORDER BY CASE status
                WHEN 'uploading' THEN 0
                WHEN 'cloud_downloading' THEN 1
                WHEN 'preparing' THEN 2
                WHEN 'ready' THEN 3
            END
            LIMIT 1
            """
            let rows = queryInternal(sql, bind: [])
            return rows.first?["source"] as? String
        }
    }

    /// Cancel all pending auto-upload items. Called when user closes auto upload
    /// so the queue is clean for manual uploads and re-enabling auto upload
    /// starts a fresh scan.
    func cancelPendingAutoItems() throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = """
            UPDATE upload_items SET status = 'cancelled', updated_at = ?1
            WHERE source = 'auto' AND status IN ('queued', 'discovered', 'preparing', 'ready', 'cloud_downloading')
            """
            try executeWithBindings(sql, bindings: [.text(now)])
        }
    }

    /// Cancel all pending and in-progress items in a manual queue.
    /// Three checkpoints in the upload loop enforce this:
    ///   1. Between files (index > 0): skips cancelled items before export
    ///   2. After export, before TCP upload: skips and cleans up temp file
    ///   3. Already in TCP: current file finishes (no mid-stream abort), then stops
    func cancelManualBatch(batchId: String) throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = """
            UPDATE upload_items SET status = 'cancelled', updated_at = ?1
            WHERE batch_id = ?2 AND status IN ('queued', 'discovered', 'preparing', 'ready', 'uploading', 'cloud_downloading')
            """
            try executeWithBindings(sql, bindings: [
                .text(now),
                .text(batchId)
            ])
        }
    }

    /// Cancel all pending and in-progress manual items, regardless of which
    /// batch they came from. Manual upload is modeled in the PRD as one
    /// continuously appended queue, not isolated per-submit batches.
    func cancelAllManualUploads() throws {
        try queue.sync {
            let now = ISO8601DateFormatter().string(from: Date())
            let sql = """
            UPDATE upload_items SET status = 'cancelled', updated_at = ?1
            WHERE source = 'manual' AND status IN ('queued', 'discovered', 'preparing', 'ready', 'uploading', 'cloud_downloading')
            """
            try executeWithBindings(sql, bindings: [
                .text(now),
            ])
        }
    }

    /// Get a single upload item by its asset local identifier (for deduplication).
    func getItemByAssetId(_ assetId: String) -> UploadItemRecord? {
        return queue.sync {
            let sql = "SELECT * FROM upload_items WHERE asset_local_id = ?1"
            let rows = queryInternal(sql, bind: [.text(assetId)])
            return rows.first.flatMap { uploadItemFromRow($0) }
        }
    }

    // MARK: - Auto Upload Config CRUD

    func getAutoUploadConfig() -> AutoUploadConfigRecord? {
        return queue.sync {
            let sql = "SELECT * FROM auto_upload_config WHERE id = 1"
            let rows = queryInternal(sql, bind: [])
            guard let row = rows.first else { return nil }
            return AutoUploadConfigRecord(
                enabled: (row["enabled"] as? Int64 ?? 0) != 0,
                // media_filter column ignored — auto upload uploads everything
                timeRangeMode: row["time_range_mode"] as? String ?? "all",
                customTimeFrom: row["custom_time_from"] as? String,
                state: row["state"] as? String ?? "disabled",
                updatedAt: row["updated_at"] as? String ?? ""
            )
        }
    }

    func saveAutoUploadConfig(_ config: AutoUploadConfigRecord) throws {
        try queue.sync {
            // media_filter column kept in schema but always written as 'all' — auto upload uploads everything
            let sql = """
            INSERT INTO auto_upload_config (id, enabled, media_filter, time_range_mode, custom_time_from, state, updated_at)
            VALUES (1, ?1, 'all', ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
              enabled = excluded.enabled,
              media_filter = 'all',
              time_range_mode = excluded.time_range_mode,
              custom_time_from = excluded.custom_time_from,
              state = excluded.state,
              updated_at = excluded.updated_at
            """
            try executeWithBindings(sql, bindings: [
                .int(config.enabled ? 1 : 0),
                .text(config.timeRangeMode),
                .textOrNull(config.customTimeFrom),
                .text(config.state),
                .text(config.updatedAt)
            ])
        }
    }

    /// Resets auto upload config to disabled state. Called when unpairing or switching devices
    /// so that the next pairing session starts with auto upload off.
    func resetAutoUploadConfig() throws {
        try queue.sync {
            try executeInternal("DELETE FROM auto_upload_config")
        }
    }

    // MARK: - Sessions CRUD

    func upsertSession(_ session: SessionRecord) throws {
        try queue.sync {
            let sql = """
            INSERT INTO sync_sessions (session_id, started_at, ended_at, state, queue_total_count, queue_total_bytes, completed_count, completed_bytes, active_file_key, active_offset, active_transmission_ms, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(session_id) DO UPDATE SET
              ended_at = excluded.ended_at,
              state = excluded.state,
              completed_count = excluded.completed_count,
              completed_bytes = excluded.completed_bytes,
              active_file_key = excluded.active_file_key,
              active_offset = excluded.active_offset,
              active_transmission_ms = excluded.active_transmission_ms,
              updated_at = excluded.updated_at
            """
            try executeWithBindings(sql, bindings: [
                .text(session.sessionId),
                .text(session.startedAt),
                .textOrNull(session.endedAt),
                .text(session.state),
                .int(Int64(session.queueTotalCount)),
                .int(session.queueTotalBytes),
                .int(Int64(session.completedCount)),
                .int(session.completedBytes),
                .textOrNull(session.activeFileKey),
                .int(session.activeOffset),
                .int(session.activeTransmissionMs),
                .text(session.updatedAt)
            ])
        }
    }

    func getActiveSession() -> SessionRecord? {
        return queue.sync {
            let sql = "SELECT * FROM sync_sessions WHERE state NOT IN ('completed', 'cancelled') ORDER BY started_at DESC LIMIT 1"
            let rows = queryInternal(sql, bind: [])
            return rows.first.flatMap { sessionFromRow($0) }
        }
    }

    func checkpointWal() throws {
        try queue.sync {
            try executeInternal("PRAGMA wal_checkpoint(FULL)")
        }
    }

    // MARK: - Generic Helpers (Public)

    func execute(_ sql: String) throws {
        try queue.sync {
            try executeInternal(sql)
        }
    }

    func executeParameterized(_ sql: String, bind: [Any]) throws {
        try queue.sync {
            let bindings = bind.map { anyToBindingValue($0) }
            try executeWithBindings(sql, bindings: bindings)
        }
    }

    func query(_ sql: String, bind: [Any]) -> [[String: Any]] {
        return queue.sync {
            let bindings = bind.map { anyToBindingValue($0) }
            return queryInternal(sql, bind: bindings)
        }
    }

    // MARK: - Internal Helpers

    private enum BindingValue {
        case text(String)
        case int(Int64)
        case double(Double)
        case null

        static func textOrNull(_ value: String?) -> BindingValue {
            if let v = value { return .text(v) }
            return .null
        }

        static func intOrNull(_ value: Int64?) -> BindingValue {
            if let v = value { return .int(v) }
            return .null
        }
    }

    private func executeInternal(_ sql: String) throws {
        var errmsg: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &errmsg) != SQLITE_OK {
            let msg = errmsg.map { String(cString: $0) } ?? "unknown error"
            sqlite3_free(errmsg)
            throw SyncEngineError.databaseError(msg)
        }
    }

    private func executeWithBindings(_ sql: String, bindings: [BindingValue]) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errmsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw SyncEngineError.databaseError("Prepare failed: \(errmsg)")
        }
        defer { sqlite3_finalize(stmt) }

        for (index, binding) in bindings.enumerated() {
            let position = Int32(index + 1)
            switch binding {
            case .text(let value):
                sqlite3_bind_text(stmt, position, (value as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            case .int(let value):
                sqlite3_bind_int64(stmt, position, value)
            case .double(let value):
                sqlite3_bind_double(stmt, position, value)
            case .null:
                sqlite3_bind_null(stmt, position)
            }
        }

        let result = sqlite3_step(stmt)
        guard result == SQLITE_DONE || result == SQLITE_ROW else {
            let errmsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw SyncEngineError.databaseError("Step failed: \(errmsg)")
        }
    }

    private func executeWithBindingsReturningChanges(_ sql: String, bindings: [BindingValue]) throws -> Int {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let errmsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw SyncEngineError.databaseError("Prepare failed: \(errmsg)")
        }
        defer { sqlite3_finalize(stmt) }

        for (index, binding) in bindings.enumerated() {
            let position = Int32(index + 1)
            switch binding {
            case .text(let value):
                sqlite3_bind_text(stmt, position, (value as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            case .int(let value):
                sqlite3_bind_int64(stmt, position, value)
            case .double(let value):
                sqlite3_bind_double(stmt, position, value)
            case .null:
                sqlite3_bind_null(stmt, position)
            }
        }

        let result = sqlite3_step(stmt)
        guard result == SQLITE_DONE || result == SQLITE_ROW else {
            let errmsg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            throw SyncEngineError.databaseError("Step failed: \(errmsg)")
        }
        return Int(sqlite3_changes(db))
    }

    private func queryInternal(_ sql: String, bind: [BindingValue]) -> [[String: Any]] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_finalize(stmt) }

        for (index, binding) in bind.enumerated() {
            let position = Int32(index + 1)
            switch binding {
            case .text(let value):
                sqlite3_bind_text(stmt, position, (value as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            case .int(let value):
                sqlite3_bind_int64(stmt, position, value)
            case .double(let value):
                sqlite3_bind_double(stmt, position, value)
            case .null:
                sqlite3_bind_null(stmt, position)
            }
        }

        var results: [[String: Any]] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            var row: [String: Any] = [:]
            let columnCount = sqlite3_column_count(stmt)
            for i in 0..<columnCount {
                let name = String(cString: sqlite3_column_name(stmt, i))
                let type = sqlite3_column_type(stmt, i)
                switch type {
                case SQLITE_INTEGER:
                    row[name] = sqlite3_column_int64(stmt, i)
                case SQLITE_FLOAT:
                    row[name] = sqlite3_column_double(stmt, i)
                case SQLITE_TEXT:
                    if let cString = sqlite3_column_text(stmt, i) {
                        row[name] = String(cString: cString)
                    }
                case SQLITE_NULL:
                    row[name] = nil
                default:
                    break
                }
            }
            results.append(row)
        }
        return results
    }

    private func anyToBindingValue(_ value: Any) -> BindingValue {
        switch value {
        case let s as String:
            return .text(s)
        case let i as Int:
            return .int(Int64(i))
        case let i as Int64:
            return .int(i)
        case let d as Double:
            return .double(d)
        default:
            return .null
        }
    }

    private func getMetaValueInternal(_ key: String) -> String? {
        let sql = "SELECT value FROM upload_store_meta WHERE key = ?1"
        return queryInternal(sql, bind: [.text(key)]).first?["value"] as? String
    }

    private func setMetaValueInternal(_ key: String, value: String?) throws {
        let now = ISO8601DateFormatter().string(from: Date())
        let sql = """
        INSERT INTO upload_store_meta (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        """
        try executeWithBindings(sql, bindings: [
            .text(key),
            .textOrNull(value),
            .text(now)
        ])
    }

    // MARK: - Row Mappers

    private func uploadItemFromRow(_ row: [String: Any]) -> UploadItemRecord? {
        guard let assetLocalId = row["asset_local_id"] as? String,
              let mediaType = row["media_type"] as? String,
              let status = row["status"] as? String,
              let updatedAt = row["updated_at"] as? String else {
            return nil
        }
        return UploadItemRecord(
            id: row["id"] as? Int64,
            assetLocalId: assetLocalId,
            modifiedAt: row["modified_at"] as? String ?? "",
            mediaType: mediaType,
            originalFilename: row["original_filename"] as? String,
            fileKey: row["file_key"] as? String,
            fileSize: row["file_size"] as? Int64,
            status: status,
            ackedOffset: row["acked_offset"] as? Int64 ?? 0,
            lastErrorCode: row["last_error_code"] as? String,
            updatedAt: updatedAt,
            source: row["source"] as? String ?? "auto",
            batchId: row["batch_id"] as? String,
            priority: Int(row["priority"] as? Int64 ?? 0),
            sourceKind: row["source_kind"] as? String ?? "photo",
            sourceFilePath: row["source_file_path"] as? String,
            mimeType: row["mime_type"] as? String
        )
    }

    private func sessionFromRow(_ row: [String: Any]) -> SessionRecord? {
        guard let sessionId = row["session_id"] as? String,
              let startedAt = row["started_at"] as? String,
              let state = row["state"] as? String,
              let updatedAt = row["updated_at"] as? String else {
            return nil
        }
        return SessionRecord(
            sessionId: sessionId,
            startedAt: startedAt,
            endedAt: row["ended_at"] as? String,
            state: state,
            queueTotalCount: Int(row["queue_total_count"] as? Int64 ?? 0),
            queueTotalBytes: row["queue_total_bytes"] as? Int64 ?? 0,
            completedCount: Int(row["completed_count"] as? Int64 ?? 0),
            completedBytes: row["completed_bytes"] as? Int64 ?? 0,
            activeFileKey: row["active_file_key"] as? String,
            activeOffset: row["active_offset"] as? Int64 ?? 0,
            activeTransmissionMs: row["active_transmission_ms"] as? Int64 ?? 0,
            updatedAt: updatedAt
        )
    }
}
