import Foundation

enum SyncEngineError: Error, LocalizedError {
    case databaseError(String)
    case networkError(String)
    case pairingError(String)
    case permissionError(String)
    case lowDiskPaused(String)
    case storageUnavailable(String, source: String)
    case autoUploadInterrupted

    var errorDescription: String? {
        switch self {
        case .databaseError(let msg): return "Database error: \(msg)"
        case .networkError(let msg): return "Network error: \(msg)"
        case .pairingError(let msg): return "Pairing rejected: \(msg)"
        case .permissionError(let msg): return "Permission error: \(msg)"
        case .lowDiskPaused(let msg): return "Low disk paused: \(msg)"
        case .storageUnavailable(let msg, let source): return "Storage unavailable (\(source)): \(msg)"
        case .autoUploadInterrupted: return "Auto upload interrupted by user"
        }
    }
}
