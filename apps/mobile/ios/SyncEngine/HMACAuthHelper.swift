import Foundation
import CryptoKit
import Security

/// Shared HMAC auth helper for sidecar HTTP endpoints that use the
/// `keyBytes = SHA256(pairingToken)` signing scheme.
///
/// Keeps the canonical-string construction and HMAC computation in one
/// place so SyncEngineManager's sidecar HTTP calls can't drift out of sync
/// with the Go sidecar.
///
enum HMACAuthHelper {
    /// GET /personal/* — 5-line canonical, LF separators, no trailing LF after
    /// `nonce` (matches sidecar personalAccessSignature).
    static func canonicalPersonalAccess(
        method: String,
        escapedPath: String,
        clientId: String,
        timestamp: String,
        nonce: String
    ) -> String {
        var out = ""
        out.append(method.uppercased()); out.append("\n")
        out.append(escapedPath); out.append("\n")
        out.append(clientId); out.append("\n")
        out.append(timestamp); out.append("\n")
        out.append(nonce)
        return out
    }

    static func personalAccessSignature(
        pairingToken: String,
        method: String,
        escapedPath: String,
        clientId: String,
        timestamp: String,
        nonce: String
    ) -> String {
        hmacSHA256Hex(
            pairingToken: pairingToken,
            canonical: canonicalPersonalAccess(
                method: method,
                escapedPath: escapedPath,
                clientId: clientId,
                timestamp: timestamp,
                nonce: nonce
            )
        )
    }

    /// HMAC-SHA256 of `canonical`, keyed by SHA256(pairingToken) as raw
    /// 32 bytes. Returns lowercase hex.
    static func hmacSHA256Hex(pairingToken: String, canonical: String) -> String {
        let keyBytes = SHA256.hash(data: Data(pairingToken.utf8))
        let symmetric = SymmetricKey(data: Data(keyBytes))
        let signature = HMAC<SHA256>.authenticationCode(
            for: Data(canonical.utf8),
            using: symmetric
        )
        return Data(signature).map { String(format: "%02x", $0) }.joined()
    }

    /// Produce a 128-bit random nonce encoded as lowercase hex.
    static func randomHexNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            for i in 0..<bytes.count {
                bytes[i] = UInt8.random(in: 0...255)
            }
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
