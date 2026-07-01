import Foundation

struct DriveEntitlementSnapshot: Equatable {
    let canUseBackgroundContinuation: Bool
    let checkedAt: Date?
    let expiresAt: Date?
}

extension DriveEntitlementSnapshot {
    static func fromBridgeParams(_ params: [String: Any]) -> DriveEntitlementSnapshot {
        return DriveEntitlementSnapshot(
            canUseBackgroundContinuation: boolValue(
                params["canUseBackgroundContinuation"]
            ),
            checkedAt: dateValue(params["checkedAt"]),
            expiresAt: dateValue(params["expiresAt"])
        )
    }

    private static func boolValue(_ rawValue: Any?) -> Bool {
        guard let rawValue, !(rawValue is NSNull) else {
            return false
        }
        if let value = rawValue as? Bool {
            return value
        }
        if let value = rawValue as? NSNumber {
            return value.boolValue
        }
        return false
    }

    private static func dateValue(_ rawValue: Any?) -> Date? {
        guard let rawValue else {
            return nil
        }
        if rawValue is NSNull {
            return nil
        }
        if let value = rawValue as? Date {
            return value
        }
        if let value = rawValue as? NSNumber {
            let seconds = value.doubleValue
            return Date(timeIntervalSince1970: seconds > 10_000_000_000 ? seconds / 1_000 : seconds)
        }
        guard let value = rawValue as? String else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return nil
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = formatter.date(from: trimmed) {
            return parsed
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let parsed = formatter.date(from: trimmed) {
            return parsed
        }
        return nil
    }
}

enum BackgroundHandoffPolicy {
    private static let entitlementMaxAge: TimeInterval = 24 * 60 * 60

    static func resolveBinding(live: StoredBinding?, persisted: BindingRecord?) -> StoredBinding? {
        if let live {
            return live
        }

        guard let persisted,
              !persisted.deviceId.isEmpty,
              !persisted.host.isEmpty,
              !persisted.pairingTokenKeychainRef.isEmpty
        else {
            return nil
        }

        return StoredBinding(
            serverId: persisted.deviceId,
            sidecarHost: persisted.host,
            port: persisted.port,
            pairingTokenKeychainRef: persisted.pairingTokenKeychainRef
        )
    }

    static func shouldContinueForegroundPipeline(
        isTransitioningToBackground: Bool,
        isSilentAudioPlaying: Bool,
        canUseBackgroundContinuation: Bool,
        isAppInBackground: Bool
    ) -> Bool {
        if isAppInBackground && !canUseBackgroundContinuation {
            return false
        }
        return !isTransitioningToBackground || (canUseBackgroundContinuation && isSilentAudioPlaying)
    }

    static func shouldForceForegroundPipelineYieldAfterEntitlementChange(
        isAppInBackground: Bool,
        isSyncing: Bool,
        canUseBackgroundContinuation: Bool
    ) -> Bool {
        isAppInBackground && isSyncing && !canUseBackgroundContinuation
    }

    static func shouldStopBackgroundContinuationRuntime(
        isAppInBackground: Bool,
        canUseBackgroundContinuation: Bool
    ) -> Bool {
        isAppInBackground && !canUseBackgroundContinuation
    }

    static func shouldSubmitBackgroundContinuedTask(
        canUseBackgroundContinuation: Bool
    ) -> Bool {
        canUseBackgroundContinuation
    }

    static func shouldRunBackgroundIncrementalScan(
        canUseBackgroundContinuation: Bool,
        autoUploadActive: Bool
    ) -> Bool {
        canUseBackgroundContinuation && autoUploadActive
    }

    static func canUseBackgroundContinuation(
        snapshot: DriveEntitlementSnapshot?,
        now: Date = Date()
    ) -> Bool {
        canUsePaidFeature(
            enabled: snapshot?.canUseBackgroundContinuation,
            checkedAt: snapshot?.checkedAt,
            expiresAt: snapshot?.expiresAt,
            now: now
        )
    }

    static func backgroundContinuationExpiryDate(
        snapshot: DriveEntitlementSnapshot?,
        now: Date = Date()
    ) -> Date? {
        guard canUseBackgroundContinuation(snapshot: snapshot, now: now),
              let checkedAt = snapshot?.checkedAt,
              let expiresAt = snapshot?.expiresAt
        else {
            return nil
        }
        let deadline = min(expiresAt, checkedAt.addingTimeInterval(entitlementMaxAge))
        return deadline >= now ? deadline : nil
    }

    private static func canUsePaidFeature(
        enabled: Bool?,
        checkedAt: Date?,
        expiresAt: Date?,
        now: Date
    ) -> Bool {
        guard enabled == true, let checkedAt, let expiresAt else {
            return false
        }
        if checkedAt > now {
            return false
        }
        if now.timeIntervalSince(checkedAt) > entitlementMaxAge {
            return false
        }
        if expiresAt <= now {
            return false
        }
        return true
    }
}
