import Foundation

enum SyncEngineError: Error, LocalizedError {
    case databaseError(String)
    case networkError(String)
    case pairingError(String)
    case structuredPairingError(code: String, message: String, meta: [String: Any]?)
    case permissionError(String)
    case lowDiskPaused(String)
    case storageUnavailable(String, source: String)
    case reconnectExhausted(String)
    case bindingChanged
    case autoUploadInterrupted
    case backgroundRuntimePaused

    var errorDescription: String? {
        switch self {
        case .databaseError(let msg): return "Database error: \(msg)"
        case .networkError(let msg): return "Network error: \(msg)"
        case .pairingError(let msg): return "Pairing rejected: \(msg)"
        case .structuredPairingError(_, let msg, _): return msg
        case .permissionError(let msg): return "Permission error: \(msg)"
        case .lowDiskPaused(let msg): return "Low disk paused: \(msg)"
        case .storageUnavailable(let msg, let source): return "Storage unavailable (\(source)): \(msg)"
        case .reconnectExhausted(let msg): return "Reconnect exhausted: \(msg)"
        case .bindingChanged: return "Binding changed while sync was running"
        case .autoUploadInterrupted: return "Auto upload interrupted by user"
        case .backgroundRuntimePaused: return "Foreground LAN sync paused because the app entered background"
        }
    }

    var nativeErrorCode: String? {
        switch self {
        case .structuredPairingError(let code, _, _):
            return code
        default:
            return nil
        }
    }

    var userInfo: [String: Any] {
        switch self {
        case .structuredPairingError(let code, let message, let meta):
            var info: [String: Any] = [
                NSLocalizedDescriptionKey: message,
                "code": code,
            ]
            if let meta {
                info["meta"] = meta
            }
            return info
        default:
            return [
                NSLocalizedDescriptionKey: errorDescription ?? "SyncEngine error",
            ]
        }
    }

    var nsError: NSError {
        NSError(domain: "SyncEngineError", code: 1, userInfo: userInfo)
    }
}
