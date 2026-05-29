import Foundation
import Security

class BindingService {
    private static let keychainServiceName = "com.vividrop.mobile.china"
    private static let legacyKeychainServiceName = "com.syncflow.mobile"
    private static let authDeviceIdKeychainServiceName = "cn.vividrop.auth-device-id"
    private static let authDeviceIdKey = "auth-device-id"
    private static let clientIdKey = "syncflow_client_id"
    private static let pairingTokenKey = "syncflow_pairing_token"
    private static let clientDisplayNameKey = "syncflow_client_display_name"
    private static let keychainMigrationDoneKey = "keychain_migration_done_v1"

    weak var uploadStore: UploadStore?

    /// The single-key name used before per-device token storage was introduced.
    /// Exposed so callers can detect and fall back to legacy tokens.
    static let legacyPairingTokenKey = pairingTokenKey

    // MARK: - Keychain Migration (com.syncflow.mobile → com.vividrop.mobile.china)

    /// Migrate keychain entries from the old bundle service name to the new one.
    /// Called once on first access; idempotent via a UserDefaults flag.
    func migrateKeychainIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.keychainMigrationDoneKey) else { return }

        let keysToMigrate = [Self.clientIdKey, Self.pairingTokenKey, Self.clientDisplayNameKey]
        var migratedCount = 0

        for key in keysToMigrate {
            if let value = readKeychainFromService(Self.legacyKeychainServiceName, key: key),
               readKeychain(key: key) == nil {
                writeKeychain(key: key, value: value)
                migratedCount += 1
                slog("[BindingService] migrated keychain key '%@' from legacy service", key)
            }
        }

        // Also migrate any per-device pairing tokens (keys starting with "pairing_token_")
        // These are discovered by querying all items under the legacy service.
        let allLegacyKeys = listKeychainKeys(service: Self.legacyKeychainServiceName)
        for legacyKey in allLegacyKeys where legacyKey.hasPrefix("pairing_token_") && !keysToMigrate.contains(legacyKey) {
            if let value = readKeychainFromService(Self.legacyKeychainServiceName, key: legacyKey),
               readKeychain(key: legacyKey) == nil {
                writeKeychain(key: legacyKey, value: value)
                migratedCount += 1
                slog("[BindingService] migrated per-device token '%@' from legacy service", legacyKey)
            }
        }

        defaults.set(true, forKey: Self.keychainMigrationDoneKey)
        if migratedCount > 0 {
            slog("[BindingService] keychain migration complete: %d entries migrated", migratedCount)
        } else {
            slog("[BindingService] keychain migration: no legacy entries found")
        }
    }

    /// Read a value from a specific keychain service (for migration).
    private func readKeychainFromService(_ service: String, key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// List all keychain account keys under a given service.
    private func listKeychainKeys(service: String) -> [String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { return [] }
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }

    // MARK: - Client ID (generated once, persisted in Keychain)

    func getOrCreateClientId() -> String {
        if let existing = readKeychain(key: Self.clientIdKey) {
            return existing
        }
        let newId = UUID().uuidString.lowercased()
        writeKeychain(key: Self.clientIdKey, value: newId)
        return newId
    }

    /// Delete the persisted clientId. The next call to `getOrCreateClientId()`
    /// will generate a fresh UUID, which is the desired behaviour when wiping
    /// the sync identity (logout / account switch / reinstall sentinel).
    func clearClientId() {
        deleteKeychain(key: Self.clientIdKey)
    }

    /// Stable physical-device identifier shared with the JS auth API layer.
    /// This survives app deletion on the same iPhone, but is not restored to a
    /// different device. Desktop uses it only to hide older sync identities in
    /// the dashboard; sync/upload identity remains `clientId`.
    func getOrCreateStableDeviceId() -> String {
        if let existing = readKeychainFromService(Self.authDeviceIdKeychainServiceName, key: Self.authDeviceIdKey) {
            return existing
        }
        let newId = UUID().uuidString.lowercased()
        writeKeychain(
            service: Self.authDeviceIdKeychainServiceName,
            key: Self.authDeviceIdKey,
            value: newId,
            accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        )
        return newId
    }

    /// Enumerate every keychain account stored under the current
    /// (`com.vividrop.mobile.china`) service. Exposed so the wipe orchestrator
    /// can discover per-device pairing tokens whose names are not known at
    /// compile time (`syncflow_pairing_token_<serverId>`).
    func listStoredKeychainKeys() -> [String] {
        return listKeychainKeys(service: Self.keychainServiceName)
    }

    // MARK: - Pairing Token

    /// Save the pairing token under the given Keychain key (per-device storage).
    func savePairingToken(_ token: String, forKey key: String) {
        writeKeychain(key: key, value: token)
    }

    /// Retrieve the pairing token stored under the given Keychain key.
    func getPairingToken(forKey key: String) -> String? {
        return readKeychain(key: key)
    }

    /// Delete the pairing token stored under the given Keychain key.
    func clearPairingToken(forKey key: String) {
        deleteKeychain(key: key)
    }

    // MARK: - Legacy single-key helpers (kept for migration / diagnostics)

    func savePairingToken(_ token: String) {
        writeKeychain(key: Self.pairingTokenKey, value: token)
    }

    func getPairingToken() -> String? {
        return readKeychain(key: Self.pairingTokenKey)
    }

    func clearPairingToken() {
        deleteKeychain(key: Self.pairingTokenKey)
    }

    // MARK: - Client Display Name

    func getClientDisplayName() -> String? {
        return readKeychain(key: Self.clientDisplayNameKey)
    }

    func saveClientDisplayName(_ name: String) {
        writeKeychain(key: Self.clientDisplayNameKey, value: name)
    }

    func clearClientDisplayName() {
        deleteKeychain(key: Self.clientDisplayNameKey)
    }

    // MARK: - Binding Version

    func currentBindingVersion() -> Int? {
        return uploadStore?.currentBindingVersion()
    }

    @discardableResult
    func bumpBindingVersion() -> Int? {
        return try? uploadStore?.bumpBindingVersion()
    }

    // MARK: - Keychain Helpers

    private func writeKeychain(key: String, value: String) {
        writeKeychain(
            service: Self.keychainServiceName,
            key: key,
            value: value,
            accessible: kSecAttrAccessibleAfterFirstUnlock
        )
    }

    private func writeKeychain(service: String, key: String, value: String, accessible: CFString) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        // Delete any existing entry first to avoid errSecDuplicateItem
        SecItemDelete(query as CFDictionary)

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = accessible
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            slog("[BindingService] Keychain write failed for %@: OSStatus=%d", key, status)
        }
    }

    private func readKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainServiceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        if status != errSecSuccess {
            slog("[BindingService] Keychain read failed for %@: OSStatus=%d", key, status)
            return nil
        }
        guard let data = result as? Data else {
            slog("[BindingService] Keychain read for %@: status OK but data cast failed", key)
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainServiceName,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
