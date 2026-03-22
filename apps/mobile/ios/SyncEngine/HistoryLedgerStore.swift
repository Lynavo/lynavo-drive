import Foundation

class HistoryLedgerStore {
    private let store: UploadStore

    init(store: UploadStore) {
        self.store = store
    }

    /// Upsert a daily ledger row.
    /// On conflict (same date + device), updates snapshot fields and accumulates counters.
    func upsertDailyLedger(
        date: String,
        deviceId: String,
        deviceName: String,
        deviceIp: String,
        fileCount: Int,
        totalBytes: Int64,
        transmissionMs: Int64
    ) throws {
        let now = ISO8601DateFormatter().string(from: Date())
        let sql = """
        INSERT INTO daily_ledgers (ledger_date, device_id, device_name_snapshot, device_ip_snapshot, file_count, total_bytes, active_transmission_ms, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(ledger_date, device_id) DO UPDATE SET
          device_name_snapshot = excluded.device_name_snapshot,
          device_ip_snapshot = excluded.device_ip_snapshot,
          file_count = file_count + excluded.file_count,
          total_bytes = total_bytes + excluded.total_bytes,
          active_transmission_ms = active_transmission_ms + excluded.active_transmission_ms,
          updated_at = excluded.updated_at
        """
        try store.executeParameterized(sql, bind: [
            date,
            deviceId,
            deviceName,
            deviceIp,
            fileCount,
            Int64(totalBytes),
            Int64(transmissionMs),
            now
        ])
    }

    /// Returns ledgers ordered by date DESC, 20 per page.
    /// `cursor` is the last `ledger_date` from the previous page.
    func getDailyLedgers(cursor: String?) -> (items: [DailyLedgerRecord], nextCursor: String?) {
        let pageSize = 20
        var sql: String
        var bindings: [Any]

        if let cursor = cursor {
            sql = "SELECT * FROM daily_ledgers WHERE ledger_date < ?1 ORDER BY ledger_date DESC LIMIT ?2"
            bindings = [cursor, Int64(pageSize + 1)]
        } else {
            sql = "SELECT * FROM daily_ledgers ORDER BY ledger_date DESC LIMIT ?1"
            bindings = [Int64(pageSize + 1)]
        }

        let rows = store.query(sql, bind: bindings)
        var items: [DailyLedgerRecord] = []
        for row in rows.prefix(pageSize) {
            if let record = ledgerFromRow(row) {
                items.append(record)
            }
        }

        let nextCursor: String? = rows.count > pageSize ? items.last?.ledgerDate : nil
        return (items: items, nextCursor: nextCursor)
    }

    // MARK: - Private

    private func ledgerFromRow(_ row: [String: Any]) -> DailyLedgerRecord? {
        guard let ledgerDate = row["ledger_date"] as? String,
              let deviceId = row["device_id"] as? String,
              let deviceNameSnapshot = row["device_name_snapshot"] as? String,
              let deviceIpSnapshot = row["device_ip_snapshot"] as? String,
              let updatedAt = row["updated_at"] as? String else {
            return nil
        }
        return DailyLedgerRecord(
            ledgerDate: ledgerDate,
            deviceId: deviceId,
            deviceNameSnapshot: deviceNameSnapshot,
            deviceIpSnapshot: deviceIpSnapshot,
            fileCount: Int(row["file_count"] as? Int64 ?? 0),
            totalBytes: row["total_bytes"] as? Int64 ?? 0,
            activeTransmissionMs: row["active_transmission_ms"] as? Int64 ?? 0,
            updatedAt: updatedAt
        )
    }
}
