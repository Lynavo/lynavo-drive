import Foundation

@main
struct ClientDisplayNameResolverTests {
    static func main() {
        var passed = true

        passed = assertEqual(
            syncFlowResolvedDefaultClientDisplayName(
                rawName: "Alice iPhone",
                model: "iPhone"
            ),
            "Alice iPhone",
            "non-generic device names should be preserved"
        ) && passed

        let genericName = syncFlowResolvedDefaultClientDisplayName(
            rawName: "iPhone",
            model: "iPhone"
        )
        passed = assertEqual(genericName, "iPhone", "generic fallback should use model only") && passed
        passed = assertFalse(genericName.contains("ABCD"), "generic fallback must not expose clientId suffix") && passed

        let blankName = syncFlowResolvedDefaultClientDisplayName(
            rawName: "  ",
            model: "iPad"
        )
        passed = assertEqual(blankName, "iPad", "blank fallback should use model only") && passed
        passed = assertFalse(blankName.contains("BEEF"), "blank fallback must not expose clientId suffix") && passed

        passed = assertEqual(
            syncFlowResolvedClientDisplayName(
                storedName: "iPhone",
                legacyName: nil,
                rawName: "iPhone 12",
                model: "iPhone",
                clientId: nil
            ),
            "iPhone 12",
            "generic stored names should fallback to the system device name"
        ) && passed

        passed = assertEqual(
            syncFlowResolvedClientDisplayName(
                storedName: "iPhone 821E",
                legacyName: nil,
                rawName: "iPhone 12",
                model: "iPhone",
                clientId: "2bb3a1c4-c7cb-4695-bf56-51b6f26a821e"
            ),
            "iPhone 12",
            "legacy generated stored names should fallback to the system device name"
        ) && passed

        passed = assertEqual(
            syncFlowResolvedClientDisplayName(
                storedName: "iPhone 821E",
                legacyName: nil,
                rawName: "iPhone 12",
                model: "iPhone",
                clientId: "2bb3a1c4-c7cb-4695-bf56-51b6f26a9999"
            ),
            "iPhone 821E",
            "stored names with non-matching suffixes should be preserved"
        ) && passed

        passed = assertEqual(
            syncFlowResolvedClientDisplayName(
                storedName: "Alice Phone",
                legacyName: nil,
                rawName: "iPhone 12",
                model: "iPhone",
                clientId: nil
            ),
            "Alice Phone",
            "custom stored names should keep highest priority"
        ) && passed

        if !passed {
            exit(1)
        }
    }

    @discardableResult
    private static func assertEqual(_ actual: String, _ expected: String, _ message: String) -> Bool {
        if actual == expected {
            return true
        }
        fputs("\(message): expected \(expected), got \(actual)\n", stderr)
        return false
    }

    @discardableResult
    private static func assertFalse(_ condition: Bool, _ message: String) -> Bool {
        if !condition {
            return true
        }
        fputs("\(message)\n", stderr)
        return false
    }
}
