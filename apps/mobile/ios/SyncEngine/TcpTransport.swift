import Foundation
import Network
import CryptoKit

// MARK: - LMUP/2 Message Types (spec Section 3.2 / 7.8)

enum LMUPMessageType: UInt16 {
    case helloReq     = 0x0001
    case helloRes     = 0x0002
    case pairReq      = 0x0003
    case pairRes      = 0x0004
    case syncBeginReq = 0x0005
    case syncBeginRes = 0x0006
    case fileInitReq  = 0x0007
    case fileInitRes  = 0x0008
    case fileData     = 0x0009
    case fileAck      = 0x000A
    case fileEndReq   = 0x000B
    case fileEndRes   = 0x000C
    case syncEndReq   = 0x000D
    case syncEndRes   = 0x000E
    case ping         = 0x000F
    case pong         = 0x0010
    case error        = 0x0011
    case authReq      = 0x0012
    case authRes      = 0x0013
    case pairingInvalidated = 0x0014
}

// MARK: - Delegate

protocol TcpTransportDelegate: AnyObject {
    func transportDidConnect()
    func transportDidDisconnect(error: Error?)
    func transportDidReceive(type: LMUPMessageType, body: Data)
}

// MARK: - TcpTransport

/// LMUP/2 client-side TCP transport using Network.framework (NWConnection).
///
/// Frame format (spec Section 7.1) — 12-byte big-endian header:
/// ```
/// magic[4]   = "LMUP"
/// version[2] = 2
/// type[2]    = LMUPMessageType
/// length[4]  = body length in bytes
/// ```
class TcpTransport {
    private var connection: NWConnection?

    /// Returns the remote endpoint's resolved IP (e.g., from NWConnection path)
    var remoteHost: String? {
        guard let path = connection?.currentPath,
              let endpoint = path.remoteEndpoint else { return nil }
        switch endpoint {
        case .hostPort(let host, _):
            return "\(host)"
        default:
            return nil
        }
    }
    private let queue = DispatchQueue(label: "com.lynavo.drive.tcp")
    weak var delegate: TcpTransportDelegate?

    // MARK: - Connect / Disconnect

    func connect(host: String, port: UInt16) {
        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port)!
        )
        connectToEndpoint(endpoint)
    }

    /// Connect using a Bonjour NWEndpoint directly (avoids IP resolution)
    func connect(endpoint: NWEndpoint) {
        connectToEndpoint(endpoint)
    }

    private func connectToEndpoint(_ endpoint: NWEndpoint) {
        slog("[TcpTransport] connectToEndpoint: \(endpoint)")
        syncDiagnosticsLog("TcpTransport", "connectToEndpoint target=\(endpoint)")

        // Cancel any existing connection before creating a new one.
        // This prevents stale receive-loop callbacks from delivering old data
        // into the new session's continuation (the "invalid magic" race).
        if let existing = connection {
            slog("[TcpTransport] cancelling previous connection before reconnecting")
            syncDiagnosticsLog("TcpTransport", "cancelling previous connection before reconnect")
            existing.stateUpdateHandler = nil
            existing.cancel()
            connection = nil
        }

        let tcpOptions = NWProtocolTCP.Options()
        tcpOptions.noDelay = true

        let params = NWParameters(tls: nil, tcp: tcpOptions)
        // Throughput mode: stay on infrastructure Wi-Fi and avoid AWDL peer links.
        params.includePeerToPeer = false
        // Lower network stack priority so upload yields CPU to foreground tasks
        // (e.g. camera recording). The kernel schedules network I/O completion
        // handlers at reduced priority, cutting thermal pressure from WiFi radio.
        params.serviceClass = .background

        connection = NWConnection(to: endpoint, using: params)
        connection?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                let remote = self?.remoteHost ?? "unknown"
                syncDiagnosticsLog("TcpTransport", "state=ready remote=\(remote)")
                self?.delegate?.transportDidConnect()
                self?.startReceiving()
            case .waiting(let error):
                slog("[TcpTransport] waiting: %@", "\(error)")
                syncDiagnosticsLog(
                    "TcpTransport",
                    "state=waiting err=\(TcpTransport.describe(error: error))"
                )
                self?.delegate?.transportDidDisconnect(error: error)
            case .failed(let error):
                slog("[TcpTransport] failed: %@", "\(error)")
                syncDiagnosticsLog(
                    "TcpTransport",
                    "state=failed err=\(TcpTransport.describe(error: error))"
                )
                self?.delegate?.transportDidDisconnect(error: error)
            case .cancelled:
                syncDiagnosticsLog("TcpTransport", "state=cancelled")
            default:
                break
            }
        }
        connection?.start(queue: queue)
    }

    /// Expand NWError into a diagnostic-friendly string that distinguishes
    /// POSIX errnos (ECONNRESET / ETIMEDOUT / ENETDOWN), DNS failures, and
    /// TLS errors — this is the single most useful signal when a laptop
    /// flips WiFi mid-transfer. Purely formatting, no side effects.
    static func describe(error: NWError) -> String {
        switch error {
        case .posix(let code):
            return "posix(\(code.rawValue) \(code))"
        case .dns(let code):
            return "dns(\(code))"
        case .tls(let code):
            return "tls(\(code))"
        @unknown default:
            return "other(\(error))"
        }
    }

    func disconnect() {
        syncDiagnosticsLog("TcpTransport", "disconnect requested remote=\(remoteHost ?? "nil")")
        connection?.cancel()
        connection = nil
    }

    // MARK: - Send Frame

    /// Encode and send a single LMUP/2 frame (12-byte header + body).
    func sendFrame(type: LMUPMessageType, body: Data) {
        var header = Data(count: 12)
        // magic "LMUP"
        header[0...3] = Data("LMUP".utf8)[0...3]
        header.withUnsafeMutableBytes { buf in
            buf.storeBytes(of: UInt16(2).bigEndian, toByteOffset: 4, as: UInt16.self)
            buf.storeBytes(of: type.rawValue.bigEndian, toByteOffset: 6, as: UInt16.self)
            buf.storeBytes(of: UInt32(body.count).bigEndian, toByteOffset: 8, as: UInt32.self)
        }
        let frame = header + body
        connection?.send(content: frame, completion: .contentProcessed({ error in
            if let error { slog("[TcpTransport] send error: %@", "\(error)") }
        }))
    }

    // MARK: - Send JSON Message

    /// Convenience: serialize a JSON dictionary and send as a control frame.
    func sendJSON(type: LMUPMessageType, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        sendFrame(type: type, body: data)
    }

    // MARK: - Send FILE_DATA (binary, spec Section 7.4)

    /// Encode a FILE_DATA frame body per spec Section 7.4:
    /// ```
    /// uint16 fileKeyLen
    /// byte   fileKey[fileKeyLen]
    /// uint64 offset
    /// byte   data[...]
    /// ```
    func sendFileData(fileKey: String, offset: Int64, chunk: Data) {
        guard let connection else { return }

        let keyData = Data(fileKey.utf8)
        let bodyLen = 2 + keyData.count + 8 + chunk.count

        // Header + FILE_DATA metadata prefix. Chunk is sent separately to avoid
        // building a second large Data copy for every frame.
        var header = Data(count: 12)
        header[0...3] = Data("LMUP".utf8)[0...3]
        header.withUnsafeMutableBytes { buf in
            buf.storeBytes(of: UInt16(2).bigEndian, toByteOffset: 4, as: UInt16.self)
            buf.storeBytes(of: LMUPMessageType.fileData.rawValue.bigEndian, toByteOffset: 6, as: UInt16.self)
            buf.storeBytes(of: UInt32(bodyLen).bigEndian, toByteOffset: 8, as: UInt32.self)
        }

        var prefix = Data(capacity: 12 + 2 + keyData.count + 8)
        prefix.append(header)

        // uint16 fileKeyLen (big-endian)
        var keyLen = UInt16(keyData.count).bigEndian
        prefix.append(Data(bytes: &keyLen, count: 2))
        // fileKey bytes
        prefix.append(keyData)
        // uint64 offset (big-endian)
        var off = UInt64(offset).bigEndian
        prefix.append(Data(bytes: &off, count: 8))

        connection.batch {
            connection.send(content: prefix, completion: .idempotent)
            connection.send(content: chunk, completion: .idempotent)
        }
    }

    // MARK: - HMAC Auth (spec Section 7.9)

    /// Compute HMAC-SHA256(pairingToken, nonce) for anti-replay authentication.
    /// Compute HMAC-SHA256 matching the sidecar's verification.
    /// Sidecar stores SHA256(pairingToken) and computes HMAC(key=sha256_bytes, data=nonce_hex_decoded).
    func computeHMAC(token: String, nonce: String) -> String {
        // 1. Hash the token with SHA256 (same as sidecar stores)
        let tokenHash = SHA256.hash(data: Data(token.utf8))
        let key = SymmetricKey(data: Data(tokenHash))

        // 2. Hex-decode the nonce (sidecar sends hex-encoded nonce)
        let nonceBytes = hexDecode(nonce)

        // 3. HMAC-SHA256(key=tokenHash, data=nonceBytes)
        let mac = HMAC<SHA256>.authenticationCode(for: nonceBytes, using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    private func hexDecode(_ hex: String) -> Data {
        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
            if let byte = UInt8(hex[index..<nextIndex], radix: 16) {
                data.append(byte)
            }
            index = nextIndex
        }
        return data
    }

    // MARK: - Receive

    private func startReceiving() {
        receiveHeader()
    }

    /// Read exactly 12 bytes for the frame header, then dispatch to body reader.
    private func receiveHeader() {
        connection?.receive(minimumIncompleteLength: 12, maximumLength: 12) { [weak self] data, _, _, error in
            guard let self, let data, data.count == 12 else {
                if let error {
                    syncDiagnosticsLog(
                        "TcpTransport",
                        "receiveHeader error=\(TcpTransport.describe(error: error))"
                    )
                    self?.delegate?.transportDidDisconnect(error: error)
                } else {
                    syncDiagnosticsLog("TcpTransport", "receiveHeader short read bytes=\(data?.count ?? 0)")
                }
                return
            }

            // Validate magic bytes
            guard String(data: data[0..<4], encoding: .utf8) == "LMUP" else {
                let asciiStr = String(data: data, encoding: .ascii)?.replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\r", with: "\\r") ?? "invalid-ascii"
                let hexStr = data.map { String(format: "%02x", $0) }.joined(separator: " ")
                slog("[TcpTransport] invalid magic! Ascii=[%@], Hex=[%@]", asciiStr, hexStr)
                self.disconnect()
                return
            }

            let type = data.withUnsafeBytes { $0.load(fromByteOffset: 6, as: UInt16.self).bigEndian }
            let length = data.withUnsafeBytes { $0.load(fromByteOffset: 8, as: UInt32.self).bigEndian }

            guard let msgType = LMUPMessageType(rawValue: type) else {
                slog("[TcpTransport] unknown type: %d", type)
                self.receiveHeader() // skip unknown and continue
                return
            }

            if length == 0 {
                self.delegate?.transportDidReceive(type: msgType, body: Data())
                self.receiveHeader()
            } else {
                self.receiveBody(type: msgType, length: Int(length))
            }
        }
    }

    /// Read `length` bytes for the frame body, deliver to delegate, then loop.
    private func receiveBody(type: LMUPMessageType, length: Int) {
        connection?.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self] data, _, _, error in
            guard let self, let data else {
                if let error {
                    syncDiagnosticsLog(
                        "TcpTransport",
                        "receiveBody error type=\(type) length=\(length) err=\(TcpTransport.describe(error: error))"
                    )
                    self?.delegate?.transportDidDisconnect(error: error)
                }
                return
            }
            self.delegate?.transportDidReceive(type: type, body: data)
            self.receiveHeader()
        }
    }

    // MARK: - Heartbeat (spec Section 7.5)

    /// Send a PING frame (empty body). Spec: 15s idle -> PING, 45s no response -> disconnect.
    func sendPing() {
        sendFrame(type: .ping, body: Data())
    }
}
