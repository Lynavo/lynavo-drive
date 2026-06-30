import Foundation
import Security

/// Minimal utility that wipes every generic-password Keychain item stored by
/// the JS auth layer (react-native-keychain, service name `cn.vividrop.auth`).
///
/// The JS auth-store keeps the access/refresh-token blob under this service
/// (see `apps/mobile/src/stores/auth-store.tsx`). Keychain entries survive
/// app deletion on iOS, which is precisely the "reinstall leak" the Phase 3
/// launch-time sentinel needs to defend against.
///
/// Kept in the app target (not the SyncEngine target) because it intentionally
/// reaches into the auth-layer's keychain service rather than the SyncEngine's.
enum AuthKeychainCleaner {
    /// `KEYCHAIN_SERVICE` from `apps/mobile/src/stores/auth-store.tsx` (line 63).
    private static let authKeychainService = "cn.vividrop.auth"

    /// Remove every `kSecClassGenericPassword` entry filed under the auth
    /// service name. Best-effort: missing entries are treated as success.
    static func clearPersistedTokens() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: authKeychainService,
        ]
        let status = SecItemDelete(query as CFDictionary)
        switch status {
        case errSecSuccess:
            slog("[AuthKeychainCleaner] cleared persisted auth tokens (service=%@)", authKeychainService)
        case errSecItemNotFound:
            slog("[AuthKeychainCleaner] no persisted auth tokens to clear (service=%@)", authKeychainService)
        default:
            slog(
                "[AuthKeychainCleaner] SecItemDelete failed for service=%@ OSStatus=%d",
                authKeychainService,
                Int(status)
            )
        }
    }
}
