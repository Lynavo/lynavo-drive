import Foundation
import Security

class BindingService {
    private static let keychainServiceName = "com.lynavo.drive.mobile"
    private static let authDeviceIdKeychainServiceName = "com.lynavo.drive.auth-device-id"
    private static let authDeviceIdKey = "auth-device-id"
    private static let clientIdKey = "lynavo_client_id"
    private static let pairingTokenKey = "lynavo_pairing_token"
    private static let clientDisplayNameKey = "lynavo_client_display_name"
    private static let keychainMigrationDoneKey = "lynavo_keychain_initialized_v1"
    private static let keychainFallbackPrefix = "lynavo_keychain_fallback_v1"

    private let keychainAvailabilityLock = NSLock()
    private var unavailableKeychainServices = Set<String>()

    weak var uploadStore: UploadStore?

    /// The single-key name used before per-device token storage was introduced.
    /// Exposed so callers can detect and fall back to legacy tokens.
    static let legacyPairingTokenKey = pairingTokenKey

    // MARK: - Keychain Initialization

    /// OSS builds do not migrate pre-Lynavo keychain entries. This method is
    /// retained as a lifecycle hook for callers that expect one-time setup.
    func migrateKeychainIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.keychainMigrationDoneKey) else { return }
        defaults.set(true, forKey: Self.keychainMigrationDoneKey)
        slog("[BindingService] keychain initialized for Lynavo Drive")
    }

    /// Read a value from a specific keychain service (for migration).
    private func readKeychainFromService(_ service: String, key: String) -> String? {
        return readKeychain(service: service, key: key)
    }

    /// List all keychain account keys under a given service.
    private func listKeychainKeys(service: String) -> [String] {
        if isKeychainUnavailable(service: service) {
            return listFallbackKeys(service: service)
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        var keys = Set(listFallbackKeys(service: service))
        if status == errSecItemNotFound {
            return Array(keys).sorted()
        }
        if status != errSecSuccess {
            markKeychainUnavailable(service: service, operation: "list", status: status)
            return Array(keys).sorted()
        }
        if let items = result as? [[String: Any]] {
            keys.formUnion(items.compactMap { $0[kSecAttrAccount as String] as? String })
        }
        return Array(keys).sorted()
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
    /// (`com.lynavo.drive.mobile`) service. Exposed so the wipe orchestrator
    /// can discover per-device pairing tokens whose names are not known at
    /// compile time (`lynavo_pairing_token_<serverId>`).
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
        if isKeychainUnavailable(service: service) {
            writeFallbackValue(service: service, key: key, value: value)
            return
        }

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
            markKeychainUnavailable(service: service, operation: "write", status: status)
            writeFallbackValue(service: service, key: key, value: value)
            return
        }
        deleteFallbackValue(service: service, key: key)
    }

    private func readKeychain(key: String) -> String? {
        return readKeychain(service: Self.keychainServiceName, key: key)
    }

    private func readKeychain(service: String, key: String) -> String? {
        if let fallbackValue = readFallbackValue(service: service, key: key) {
            return fallbackValue
        }

        if isKeychainUnavailable(service: service) {
            return nil
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return readFallbackValue(service: service, key: key)
        }
        if status != errSecSuccess {
            markKeychainUnavailable(service: service, operation: "read", status: status)
            return readFallbackValue(service: service, key: key)
        }
        guard let data = result as? Data else {
            slog("[BindingService] Keychain read for %@: status OK but data cast failed", key)
            return readFallbackValue(service: service, key: key)
        }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain(key: String) {
        deleteKeychain(service: Self.keychainServiceName, key: key)
    }

    private func deleteKeychain(service: String, key: String) {
        if !isKeychainUnavailable(service: service) {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: key,
            ]
            let status = SecItemDelete(query as CFDictionary)
            if status != errSecSuccess && status != errSecItemNotFound {
                markKeychainUnavailable(service: service, operation: "delete", status: status)
            }
        }
        deleteFallbackValue(service: service, key: key)
    }

    private func isKeychainUnavailable(service: String) -> Bool {
        keychainAvailabilityLock.lock()
        defer { keychainAvailabilityLock.unlock() }
        return unavailableKeychainServices.contains(service)
    }

    private func markKeychainUnavailable(service: String, operation: String, status: OSStatus) {
        keychainAvailabilityLock.lock()
        let inserted = unavailableKeychainServices.insert(service).inserted
        keychainAvailabilityLock.unlock()
        if inserted {
            slog(
                "[BindingService] Keychain %@ failed for service %@: OSStatus=%d; using local fallback for this run",
                operation,
                service,
                status
            )
        }
    }

    private func fallbackDefaultsKey(service: String, key: String) -> String {
        return "\(Self.keychainFallbackPrefix).\(service).\(key)"
    }

    private func fallbackDefaultsPrefix(service: String) -> String {
        return "\(Self.keychainFallbackPrefix).\(service)."
    }

    private func readFallbackValue(service: String, key: String) -> String? {
        return UserDefaults.standard.string(forKey: fallbackDefaultsKey(service: service, key: key))
    }

    private func writeFallbackValue(service: String, key: String, value: String) {
        UserDefaults.standard.set(value, forKey: fallbackDefaultsKey(service: service, key: key))
        UserDefaults.standard.synchronize()
    }

    private func deleteFallbackValue(service: String, key: String) {
        UserDefaults.standard.removeObject(forKey: fallbackDefaultsKey(service: service, key: key))
        UserDefaults.standard.synchronize()
    }

    private func listFallbackKeys(service: String) -> [String] {
        let prefix = fallbackDefaultsPrefix(service: service)
        return UserDefaults.standard.dictionaryRepresentation().keys.compactMap { rawKey in
            guard rawKey.hasPrefix(prefix) else { return nil }
            return String(rawKey.dropFirst(prefix.count))
        }
    }
}
