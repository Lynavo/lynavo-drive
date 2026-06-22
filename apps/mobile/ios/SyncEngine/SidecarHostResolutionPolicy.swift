import Foundation

enum SidecarHostResolutionPolicy {
    static func preferredHost(probedHost: String?, deviceHost: String?) -> String? {
        let probed = normalizedHost(probedHost)
        let device = normalizedHost(deviceHost)

        if let probed, isUsableProbedHost(probed) {
            return probed
        }
        if let device, !isLoopbackHostValue(device) {
            return device
        }
        if let probed, !isLoopbackHostValue(probed) {
            return probed
        }
        return nil
    }

    static func isLoopbackHost(_ rawHost: String?) -> Bool {
        guard let host = normalizedHost(rawHost) else {
            return false
        }
        return isLoopbackHostValue(host)
    }

    static func usableFallbackHost(_ rawHost: String?) -> String? {
        guard let host = normalizedHost(rawHost),
              !isLoopbackHostValue(host)
        else {
            return nil
        }
        return host
    }

    private static func normalizedHost(_ rawHost: String?) -> String? {
        let host = rawHost?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return host.isEmpty ? nil : host
    }

    private static func isUsableProbedHost(_ host: String) -> Bool {
        !isLoopbackHostValue(host) && !host.contains(":")
    }

    private static func isLoopbackHostValue(_ host: String) -> Bool {
        let normalized = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return normalized == "localhost" ||
            normalized == "::1" ||
            normalized.hasPrefix("127.")
    }
}
