import Foundation
import Network

/// Wraps TcpTransport delegate callbacks into async/await using CheckedContinuation.
///
/// The LMUP/2 protocol is request/response, so ProtocolSession serializes
/// send-and-wait calls.  For FILE_DATA the server streams FILE_ACK back; in v1
/// we simply await the next incoming frame after each chunk.
class ProtocolSession: NSObject, TcpTransportDelegate {

    private let transport: TcpTransport
    private var pendingContinuation: CheckedContinuation<(LMUPMessageType, Data), Error>?
    private var connectContinuation: CheckedContinuation<Void, Error>?
    private let lock = NSLock()

    init(transport: TcpTransport) {
        self.transport = transport
        super.init()
        self.transport.delegate = self
    }

    // MARK: - Async Connect

    /// Connect to the host and await the NWConnection `.ready` state.
    func connect(host: String, port: UInt16) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            lock.lock()
            connectContinuation = cont
            lock.unlock()
            transport.connect(host: host, port: port)
        }
    }

    func connect(endpoint: NWEndpoint) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            lock.lock()
            connectContinuation = cont
            lock.unlock()
            transport.connect(endpoint: endpoint)
        }
    }

    // MARK: - Send & Receive

    /// Send a JSON control message and wait for the next server response.
    func sendAndReceive(type: LMUPMessageType, payload: [String: Any]) async throws -> (LMUPMessageType, [String: Any]) {
        transport.sendJSON(type: type, payload: payload)
        let (respType, respData) = try await waitForResponse()
        if respData.isEmpty {
            return (respType, [:])
        }
        guard let json = try? JSONSerialization.jsonObject(with: respData) as? [String: Any] else {
            throw SyncEngineError.networkError("Invalid JSON in \(respType) response")
        }
        return (respType, json)
    }

    /// Wait for the next incoming frame without sending anything first.
    /// Used after FILE_DATA to wait for FILE_ACK.
    func waitForNextMessage() async throws -> (LMUPMessageType, [String: Any]) {
        let (respType, respData) = try await waitForResponse()
        if respData.isEmpty {
            return (respType, [:])
        }
        guard let json = try? JSONSerialization.jsonObject(with: respData) as? [String: Any] else {
            return (respType, [:])
        }
        return (respType, json)
    }

    // MARK: - Private

    private func waitForResponse() async throws -> (LMUPMessageType, Data) {
        try await withCheckedThrowingContinuation { cont in
            lock.lock()
            pendingContinuation = cont
            lock.unlock()
        }
    }

    // MARK: - TcpTransportDelegate

    func transportDidConnect() {
        NSLog("[ProtocolSession] TCP connected")
        lock.lock()
        let cont = connectContinuation
        connectContinuation = nil
        lock.unlock()
        cont?.resume(returning: ())
    }

    func transportDidDisconnect(error: Error?) {
        let err = error ?? SyncEngineError.networkError("Disconnected")
        NSLog("[ProtocolSession] TCP disconnected: \(err)")

        lock.lock()
        let connCont = connectContinuation
        connectContinuation = nil
        let msgCont = pendingContinuation
        pendingContinuation = nil
        lock.unlock()

        connCont?.resume(throwing: SyncEngineError.networkError("Connection failed: \(err)"))
        msgCont?.resume(throwing: SyncEngineError.networkError("Disconnected: \(err)"))
    }

    func transportDidReceive(type: LMUPMessageType, body: Data) {
        // Silently handle PONG — don't deliver to pending continuation
        if type == .pong {
            NSLog("[ProtocolSession] received PONG (ignored)")
            return
        }

        lock.lock()
        let cont = pendingContinuation
        pendingContinuation = nil
        lock.unlock()

        if let cont {
            cont.resume(returning: (type, body))
        } else {
            NSLog("[ProtocolSession] received \(type) but no continuation pending — dropped")
        }
    }
}
