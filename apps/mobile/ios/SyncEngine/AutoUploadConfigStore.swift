import Foundation

/// CRUD wrapper for the `auto_upload_config` SQLite table (single-row config).
/// Shares the same SQLite database connection as UploadStore.
class AutoUploadConfigStore {
    private let store: UploadStore

    init(store: UploadStore) {
        self.store = store
    }

    // MARK: - Read

    /// Returns the current auto upload configuration, or a default if none exists.
    func getConfig() -> AutoUploadConfigRecord {
        if let record = store.getAutoUploadConfig() {
            return record
        }
        // Return default config when no row exists yet
        return AutoUploadConfigRecord(
            enabled: false,
            timeRangeMode: "from_now",
            customTimeFrom: nil,
            state: "disabled",
            updatedAt: ""
        )
    }

    // MARK: - Write

    /// Save the auto upload configuration (insert or update the single row).
    func saveConfig(_ config: AutoUploadConfigRecord) throws {
        var configToSave = config
        configToSave.updatedAt = ISO8601DateFormatter().string(from: Date())
        try store.saveAutoUploadConfig(configToSave)
        NSLog("[AutoUploadConfigStore] config saved: enabled=%d, timeRangeMode=%@",
              config.enabled ? 1 : 0, config.timeRangeMode)
    }

    // MARK: - Helpers

    /// Returns the time threshold for auto scanning based on the current config.
    /// Returns nil if no time filter should be applied (mode is 'all').
    func resolvedTimeThreshold() -> Date? {
        let config = getConfig()
        guard config.enabled else { return nil }

        switch config.timeRangeMode {
        case "from_now":
            // "from_now" means only assets created after the config was saved.
            // Use the updatedAt timestamp as the threshold.
            if !config.updatedAt.isEmpty {
                return ISO8601DateFormatter().date(from: config.updatedAt)
            }
            return Date()
        case "from_today":
            return Calendar.current.startOfDay(for: Date())
        case "custom":
            if let customFrom = config.customTimeFrom, !customFrom.isEmpty {
                if let parsed = ISO8601DateFormatter().date(from: customFrom) {
                    return parsed
                }
                // Also try with fractional seconds (toISOString() format)
                let fmtFrac = ISO8601DateFormatter()
                fmtFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let parsed = fmtFrac.date(from: customFrom) {
                    return parsed
                }
                NSLog("[AutoUploadConfig] failed to parse customTimeFrom: %@, falling back to no filter", customFrom)
            }
            return nil
        case "all":
            return nil
        default:
            return nil
        }
    }

}
