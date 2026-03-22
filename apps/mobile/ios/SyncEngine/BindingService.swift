import Foundation
import Security

class BindingService {
    private static let keychainServiceName = "com.syncflow.mobile"
    private static let clientIdKey = "syncflow_client_id"
    private static let pairingTokenKey = "syncflow_pairing_token"

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

    func savePairingToken(_ token: String) {
        writeKeychain(key: Self.pairingTokenKey, value: token)
    }

    func getPairingToken() -> String? {
        return readKeychain(key: Self.pairingTokenKey)
    }

    func clearPairingToken() {
        deleteKeychain(key: Self.pairingTokenKey)
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
