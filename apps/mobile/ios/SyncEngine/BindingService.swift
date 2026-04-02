import Foundation
import Security

class BindingService {
    private static let keychainServiceName = "com.syncflow.mobile"
    private static let clientIdKey = "syncflow_client_id"
    private static let pairingTokenKey = "syncflow_pairing_token"
    private static let clientDisplayNameKey = "syncflow_client_display_name"

    /// The single-key name used before per-device token storage was introduced.
    /// Exposed so callers can detect and fall back to legacy tokens.
    static let legacyPairingTokenKey = pairingTokenKey

    // MARK: - Client ID (generated once, persisted in Keychain)

    func getOrCreateClientId() -> String {
        if let existing = readKeychain(key: Self.clientIdKey) {
            return existing
        }
        let newId = UUID().uuidString.lowercased()
        writeKeychain(key: Self.clientIdKey, value: newId)
        return newId
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

    // MARK: - Keychain Helpers

    private func writeKeychain(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainServiceName,
            kSecAttrAccount as String: key,
        ]
        // Delete any existing entry first to avoid errSecDuplicateItem
        SecItemDelete(query as CFDictionary)

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            NSLog("[BindingService] Keychain write failed for %@: OSStatus=%d", key, status)
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
            NSLog("[BindingService] Keychain read failed for %@: OSStatus=%d", key, status)
            return nil
        }
        guard let data = result as? Data else {
            NSLog("[BindingService] Keychain read for %@: status OK but data cast failed", key)
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
