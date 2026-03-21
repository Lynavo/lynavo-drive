import Foundation

enum SyncEngineError: Error {
    case databaseError(String)
    case networkError(String)
    case pairingError(String)
    case permissionError(String)
}
