import Foundation
import Network

/// Wraps TcpTransport delegate callbacks into async/await using CheckedContinuation.
///
/// The LMUP/2 protocol is request/response, so ProtocolSession serializes
/// send-and-wait calls.  For FILE_DATA the server streams FILE_ACK back; in v1
/// we simply await the next incoming frame after each chunk.
class ProtocolSession: NSObject, TcpTransportDelegate {

    private static let connectTimeoutNs: UInt64 = 5_000_000_000

    private let transport: TcpTransport
    private var pendingContinuation: CheckedContinuation<(LMUPMessageType, Data), Error>?
    private var connectContinuation: CheckedContinuation<Void, Error>?
    private var bufferedMessages: [(LMUPMessageType, Data)] = []
    private var disconnectedError: Error?
    private var connectAttemptId: UInt64 = 0
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
            disconnectedError = nil
            connectAttemptId += 1
            let attemptId = connectAttemptId
            connectContinuation = cont
            lock.unlock()
            scheduleConnectTimeout(forAttempt: attemptId)
            transport.connect(host: host, port: port)
        }
    }

    func connect(endpoint: NWEndpoint) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            lock.lock()
            disconnectedError = nil
            connectAttemptId += 1
            let attemptId = connectAttemptId
            connectContinuation = cont
            lock.unlock()
            scheduleConnectTimeout(forAttempt: attemptId)
            transport.connect(endpoint: endpoint)
        }
    }

    func disconnect() {
        transport.disconnect()
    }

    /// Abort the current in-flight await without tearing down the underlying TCP
    /// connection. This is used when the user interrupts auto upload: the sync
    /// pipeline should stop immediately, but the desktop must not briefly mark
    /// the phone as offline just because we cancelled a pending request/ACK wait.
    func interruptPendingResponse(error: Error) {
        lock.lock()
        disconnectedError = error
        let msgCont = pendingContinuation
        pendingContinuation = nil
        bufferedMessages.removeAll(keepingCapacity: false)
        lock.unlock()

        msgCont?.resume(throwing: error)
    }

    // MARK: - Binary Send (FILE_DATA)

    /// Send binary FILE_DATA frame through the correct transport
    func sendFileData(fileKey: String, offset: Int64, chunk: Data) {
        transport.sendFileData(fileKey: fileKey, offset: offset, chunk: chunk)
    }

    // MARK: - Send & Receive

    /// Send a JSON control message and wait for the next server response.
    /// Sets the continuation BEFORE sending to avoid race conditions.
    func sendAndReceive(type: LMUPMessageType, payload: [String: Any]) async throws -> (LMUPMessageType, [String: Any]) {
        let (respType, respData): (LMUPMessageType, Data) = try await withCheckedThrowingContinuation { cont in
            lock.lock()
            if let disconnectedError {
                lock.unlock()
                cont.resume(throwing: SyncEngineError.networkError("Disconnected: \(disconnectedError)"))
                return
            }
            pendingContinuation = cont
            lock.unlock()
            // Send AFTER continuation is set — so we can't miss the response
            transport.sendJSON(type: type, payload: payload)
        }
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

    private func scheduleConnectTimeout(forAttempt attemptId: UInt64) {
        let delay = DispatchTimeInterval.nanoseconds(Int(Self.connectTimeoutNs))
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }

            self.lock.lock()
            guard self.connectAttemptId == attemptId, let cont = self.connectContinuation else {
                self.lock.unlock()
                return
            }
            self.connectContinuation = nil
            self.disconnectedError = SyncEngineError.networkError("Connection timed out")
            self.lock.unlock()

            self.transport.disconnect()
            cont.resume(throwing: SyncEngineError.networkError("Connection timed out"))
        }
    }

    private func waitForResponse() async throws -> (LMUPMessageType, Data) {
        try await withCheckedThrowingContinuation { cont in
            lock.lock()
            if let disconnectedError {
                lock.unlock()
                cont.resume(throwing: SyncEngineError.networkError("Disconnected: \(disconnectedError)"))
                return
            }
            if !bufferedMessages.isEmpty {
                let next = bufferedMessages.removeFirst()
                lock.unlock()
                cont.resume(returning: next)
                return
            }
            pendingContinuation = cont
            lock.unlock()
        }
    }

    func debugBufferedMessageCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return bufferedMessages.count
    }

    // MARK: - TcpTransportDelegate

    func transportDidConnect() {
        NSLog("[ProtocolSession] TCP connected")
        lock.lock()
        disconnectedError = nil
        let cont = connectContinuation
        connectContinuation = nil
        lock.unlock()
        cont?.resume(returning: ())
    }

    func transportDidDisconnect(error: Error?) {
        let err = error ?? SyncEngineError.networkError("Disconnected")
        NSLog("[ProtocolSession] TCP disconnected: \(err)")

        lock.lock()
        disconnectedError = err
        let connCont = connectContinuation
        connectContinuation = nil
        let msgCont = pendingContinuation
        pendingContinuation = nil
        bufferedMessages.removeAll(keepingCapacity: false)
        lock.unlock()

        connCont?.resume(throwing: SyncEngineError.networkError("Connection failed: \(err)"))
        msgCont?.resume(throwing: SyncEngineError.networkError("Disconnected: \(err)"))
    }

    func transportDidReceive(type: LMUPMessageType, body: Data) {
        // Heartbeats are transport-level concerns and should not consume message continuations.
        if type == .pong {
            return
        }
        if type == .ping {
            transport.sendFrame(type: .pong, body: Data())
            return
        }

        lock.lock()
        if disconnectedError != nil {
            lock.unlock()
            return
        }
        let cont = pendingContinuation
        if cont != nil {
            pendingContinuation = nil
        } else {
            if bufferedMessages.count >= 512 {
                bufferedMessages.removeFirst(bufferedMessages.count - 511)
            }
            bufferedMessages.append((type, body))
        }
        lock.unlock()

        if let cont {
            cont.resume(returning: (type, body))
        }
    }
}
