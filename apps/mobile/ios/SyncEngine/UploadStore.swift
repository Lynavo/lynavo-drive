import Foundation
import SQLite3

// MARK: - Model Structs

struct BindingRecord {
    let deviceId: String
    let deviceName: String
    var deviceAlias: String?
    let deviceType: String
    let host: String
    let port: Int
    let pairingId: String
    let pairingTokenKeychainRef: String
    var shareName: String?
    let lastBoundAt: String
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
    var tempFilePath: String?
    var ackedOffset: Int64
    var lastErrorCode: String?
    let updatedAt: String
    var source: String  // 'auto' | 'manual'
    var batchId: String?
    var priority: Int  // 0 = auto (default), 1 = manual (higher priority)
}

struct AutoUploadConfigRecord {
    var enabled: Bool
    var mediaFilter: String  // 'all' | 'photos' | 'videos'
    var timeRangeMode: String  // 'from_now' | 'from_today' | 'all' | 'custom'
    var customTimeFrom: String?
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
    private let queue = DispatchQueue(label: "com.syncflow.uploadstore", qos: .userInitiated)

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
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("syncflow.db").path
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
          last_bound_at               TEXT NOT NULL
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
          temp_file_path  TEXT,
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
        """
        try executeInternal(sql)

        // Migration: change UNIQUE(asset_local_id, modified_at) to UNIQUE(asset_local_id)
        // SQLite doesn't support ALTER UNIQUE, so recreate the table if old constraint exists
        let tableInfo = try queryInternal("SELECT sql FROM sqlite_master WHERE type='table' AND name='upload_items'", bind: [])
        if let createSQL = tableInfo.first?["sql"] as? String,
           createSQL.contains("UNIQUE(asset_local_id, modified_at)") {
            NSLog("[UploadStore] migrating upload_items: removing modified_at from UNIQUE constraint")
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
                  temp_file_path  TEXT,
                  acked_offset    INTEGER NOT NULL DEFAULT 0,
                  last_error_code TEXT,
                  updated_at      TEXT NOT NULL,
                  UNIQUE(asset_local_id)
                );
                INSERT OR REPLACE INTO upload_items_new SELECT * FROM upload_items;
                DROP TABLE upload_items;
                ALTER TABLE upload_items_new RENAME TO upload_items;
            """)
            NSLog("[UploadStore] migration complete")
        }

        // Migration: add source, batch_id, priority columns to upload_items (Vivi Drop)
        let columnCheck = queryInternal(
            "SELECT COUNT(*) AS cnt FROM pragma_table_info('upload_items') WHERE name = 'source'",
            bind: []
        )
        let hasSourceColumn = (columnCheck.first?["cnt"] as? Int64 ?? 0) > 0
        if !hasSourceColumn {
            NSLog("[UploadStore] migrating upload_items: adding source, batch_id, priority columns")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN batch_id TEXT")
            try executeInternal("ALTER TABLE upload_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
            NSLog("[UploadStore] Vivi Drop columns migration complete")
        }

        // Create auto_upload_config table (single-row config)
        try executeInternal("""
            CREATE TABLE IF NOT EXISTS auto_upload_config (
              id                INTEGER PRIMARY KEY CHECK (id = 1),
              enabled           INTEGER NOT NULL DEFAULT 0,
              media_filter      TEXT NOT NULL DEFAULT 'all',
              time_range_mode   TEXT NOT NULL DEFAULT 'from_now',
              custom_time_from  TEXT,
              updated_at        TEXT NOT NULL DEFAULT ''
            );
        """)
    }

    // MARK: - Binding CRUD

    func getBinding() -> BindingRecord? {
        return queue.sync {
            let sql = "SELECT device_id, device_name, device_alias, device_type, host, port, pairing_id, pairing_token_keychain_ref, share_name, last_bound_at FROM binding WHERE id = 1"
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
                lastBoundAt: row["last_bound_at"] as? String ?? ""
            )
        }
    }

    func saveBinding(_ binding: BindingRecord) throws {
        try queue.sync {
            let sql = """
            INSERT OR REPLACE INTO binding (id, device_id, device_name, device_alias, device_type, host, port, pairing_id, pairing_token_keychain_ref, share_name, last_bound_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
                .text(binding.lastBoundAt)
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

    private func upsertUploadItemsInternal(_ items: [UploadItemRecord]) throws {
        let sql = """
        INSERT INTO upload_items (asset_local_id, modified_at, media_type, original_filename, file_key, file_size, status, temp_file_path, acked_offset, last_error_code, updated_at, source, batch_id, priority)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(asset_local_id) DO UPDATE SET
          media_type = excluded.media_type,
          original_filename = excluded.original_filename,
          file_key = excluded.file_key,
          file_size = excluded.file_size,
          status = excluded.status,
          temp_file_path = excluded.temp_file_path,
          acked_offset = excluded.acked_offset,
          last_error_code = excluded.last_error_code,
          updated_at = excluded.updated_at,
          source = excluded.source,
          batch_id = excluded.batch_id,
          priority = excluded.priority
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
                    .textOrNull(item.tempFilePath),
                    .int(item.ackedOffset),
                    .textOrNull(item.lastErrorCode),
                    .text(item.updatedAt),
                    .text(item.source),
                    .textOrNull(item.batchId),
                    .int(Int64(item.priority))
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

    /// Cancel all pending and in-progress items in a manual batch.
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
                mediaFilter: row["media_filter"] as? String ?? "all",
                timeRangeMode: row["time_range_mode"] as? String ?? "from_now",
                customTimeFrom: row["custom_time_from"] as? String,
                updatedAt: row["updated_at"] as? String ?? ""
            )
        }
    }

    func saveAutoUploadConfig(_ config: AutoUploadConfigRecord) throws {
        try queue.sync {
            let sql = """
            INSERT INTO auto_upload_config (id, enabled, media_filter, time_range_mode, custom_time_from, updated_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
              enabled = excluded.enabled,
              media_filter = excluded.media_filter,
              time_range_mode = excluded.time_range_mode,
              custom_time_from = excluded.custom_time_from,
              updated_at = excluded.updated_at
            """
            try executeWithBindings(sql, bindings: [
                .int(config.enabled ? 1 : 0),
                .text(config.mediaFilter),
                .text(config.timeRangeMode),
                .textOrNull(config.customTimeFrom),
                .text(config.updatedAt)
            ])
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
            tempFilePath: row["temp_file_path"] as? String,
            ackedOffset: row["acked_offset"] as? Int64 ?? 0,
            lastErrorCode: row["last_error_code"] as? String,
            updatedAt: updatedAt,
            source: row["source"] as? String ?? "auto",
            batchId: row["batch_id"] as? String,
            priority: Int(row["priority"] as? Int64 ?? 0)
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
