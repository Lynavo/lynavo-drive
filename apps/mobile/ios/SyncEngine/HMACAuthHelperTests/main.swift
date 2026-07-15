import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("HMACAuthHelperTests failed: \(message)\n", stderr)
        exit(1)
    }
}

let canonical = HMACAuthHelper.canonicalPersonalAccess(
    method: "get",
    escapedPath: "/personal/download/Photos%2FIMG_0001.JPG",
    clientId: "phone-123",
    timestamp: "2026-06-22T10:20:30.123Z",
    nonce: "nonce-123"
)

expect(
    canonical == """
GET
/personal/download/Photos%2FIMG_0001.JPG
phone-123
2026-06-22T10:20:30.123Z
nonce-123
""",
    "personal access canonical string must match sidecar line order"
)

let signature = HMACAuthHelper.hmacSHA256Hex(
    pairingToken: "pairing-token-secret",
    canonical: canonical
)

expect(
    signature == "6fc9632974ae6a98854607cda3c7dac1327247e86d733098cc2a1a065c83d050",
    "personal access signature must use SHA256(pairingToken) as raw HMAC key"
)

let signed = HMACAuthHelper.personalAccessSignature(
    pairingToken: "pairing-token-secret",
    method: "GET",
    escapedPath: "/personal/list",
    clientId: "phone-123",
    timestamp: "2026-06-22T10:20:30.123Z",
    nonce: "nonce-456"
)

expect(
    signed == "94ef62337c99a78061a32ea4bd9b04ecb3d263f003a8174881afb1e2e4d00421",
    "personalAccessSignature must wrap canonicalPersonalAccess and HMAC calculation"
)
