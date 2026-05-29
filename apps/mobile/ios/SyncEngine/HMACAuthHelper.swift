import Foundation
import CryptoKit

/// Shared HMAC auth helper for sidecar HTTP endpoints that use the
/// `keyBytes = SHA256(pairingToken)` signing scheme (POST /upload/<cid>,
/// DELETE /upload/<cid>/<fkey>).
///
/// Keeps the canonical-string construction and HMAC computation in one
/// place so SyncEngineManager (DELETE reset) and BackgroundUploadService
/// (POST upload) can't drift out of sync with the Go sidecar.
///
/// Canonical format matches plan spec at
/// docs/architecture/background-upload-plan.md:
///   - POST: 12 fields, lines 101-131, separator LF, NO trailing LF after nonce
///   - DELETE: 6 fields, lines 621-631, separator LF, NO trailing LF after nonce
/// Sidecar `canonicalPOSTString` / `canonicalDELETEString` in
/// services/sidecar-go/internal/api/handlers_upload.go emit the same form.
enum HMACAuthHelper {
    /// DELETE /upload/<clientId>/<fileKey> — 6-line canonical, LF separators,
    /// no trailing LF after `nonce` (matches sidecar canonicalDELETEString).
    static func canonicalDELETE(
        path: String,
        clientId: String,
        fileKey: String,
        timestamp: String,
        nonce: String
    ) -> String {
        var out = ""
        out.append("DELETE\n")
        out.append(path); out.append("\n")
        out.append(clientId); out.append("\n")
        out.append(fileKey); out.append("\n")
        out.append(timestamp); out.append("\n")
        out.append(nonce)
        return out
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
