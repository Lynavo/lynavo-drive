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
    private let queue = DispatchQueue(label: "com.syncflow.tcp")
    weak var delegate: TcpTransportDelegate?

    // MARK: - Connect / Disconnect

    func connect(host: String, port: UInt16) {
        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: port)!
        )
        connection = NWConnection(to: endpoint, using: .tcp)
        connection?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.delegate?.transportDidConnect()
                self?.startReceiving()
            case .failed(let error):
                self?.delegate?.transportDidDisconnect(error: error)
            default:
                break
            }
        }
        connection?.start(queue: queue)
    }

    func disconnect() {
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
            if let error { print("[TcpTransport] send error: \(error)") }
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
        let keyData = Data(fileKey.utf8)
        var body = Data()
        // uint16 fileKeyLen (big-endian)
        var keyLen = UInt16(keyData.count).bigEndian
        body.append(Data(bytes: &keyLen, count: 2))
        // fileKey bytes
        body.append(keyData)
        // uint64 offset (big-endian)
        var off = UInt64(offset).bigEndian
        body.append(Data(bytes: &off, count: 8))
        // chunk data
        body.append(chunk)
        sendFrame(type: .fileData, body: body)
    }

    // MARK: - HMAC Auth (spec Section 7.9)

    /// Compute HMAC-SHA256(pairingToken, nonce) for anti-replay authentication.
    func computeHMAC(token: String, nonce: String) -> String {
        let key = SymmetricKey(data: Data(token.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(nonce.utf8), using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Receive

    private func startReceiving() {
        receiveHeader()
    }

    /// Read exactly 12 bytes for the frame header, then dispatch to body reader.
    private func receiveHeader() {
        connection?.receive(minimumIncompleteLength: 12, maximumLength: 12) { [weak self] data, _, _, error in
            guard let self, let data, data.count == 12 else {
                if let error { self?.delegate?.transportDidDisconnect(error: error) }
                return
            }

            // Validate magic bytes
            guard String(data: data[0..<4], encoding: .utf8) == "LMUP" else {
                print("[TcpTransport] invalid magic")
                self.disconnect()
                return
            }

            let type = data.withUnsafeBytes { $0.load(fromByteOffset: 6, as: UInt16.self).bigEndian }
            let length = data.withUnsafeBytes { $0.load(fromByteOffset: 8, as: UInt32.self).bigEndian }

            guard let msgType = LMUPMessageType(rawValue: type) else {
                print("[TcpTransport] unknown type: \(type)")
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
                if let error { self?.delegate?.transportDidDisconnect(error: error) }
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
