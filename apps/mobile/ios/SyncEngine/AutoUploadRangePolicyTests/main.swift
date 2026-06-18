import Foundation
import Photos

struct AutoUploadConfigRecord {
    var enabled: Bool
    var timeRangeMode: String
    var customTimeFrom: String?
    var state: String
    var updatedAt: String
}

final class UploadStore {
    var record: AutoUploadConfigRecord?

    init(record: AutoUploadConfigRecord?) {
        self.record = record
    }

    func getAutoUploadConfig() -> AutoUploadConfigRecord? {
        record
    }

    func saveAutoUploadConfig(_ config: AutoUploadConfigRecord) throws {
        record = config
    }
}

func slog(_ message: String, _ args: CVarArg...) {}

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("AutoUploadRangePolicyTests failed: \(message)\n", stderr)
        exit(1)
    }
}

func makeConfigStore(
    enabled: Bool,
    mode: String,
    customTimeFrom: String? = nil,
    updatedAt: String = "2026-06-17T04:05:06Z"
) -> AutoUploadConfigStore {
    AutoUploadConfigStore(store: UploadStore(record: AutoUploadConfigRecord(
        enabled: enabled,
        timeRangeMode: mode,
        customTimeFrom: customTimeFrom,
        state: enabled ? "active" : "disabled",
        updatedAt: updatedAt
    )))
}

let plainFormatter = ISO8601DateFormatter()
let fractionalFormatter = ISO8601DateFormatter()
fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

let updatedAtPlain = plainFormatter.date(from: "2026-06-17T04:05:06Z")!
let updatedAtFractional = fractionalFormatter.date(from: "2026-06-17T04:05:06.000Z")!
let customDate = fractionalFormatter.date(from: "2026-06-16T03:04:05.000Z")!

expect(
    makeConfigStore(
        enabled: false,
        mode: "custom",
        customTimeFrom: "2026-06-16T03:04:05.000Z"
    ).resolvedTimeThreshold() == nil,
    "disabled config must not apply a range threshold"
)

expect(
    makeConfigStore(enabled: true, mode: "all").resolvedTimeThreshold() == nil,
    "all range must scan all photos and videos"
)

expect(
    makeConfigStore(enabled: true, mode: "from_now").resolvedTimeThreshold() == updatedAtPlain,
    "from_now must use updatedAt as scan threshold"
)

expect(
    makeConfigStore(
        enabled: true,
        mode: "from_now",
        updatedAt: "2026-06-17T04:05:06.000Z"
    ).resolvedTimeThreshold() == updatedAtFractional,
    "from_now must tolerate fractional ISO timestamps"
)

expect(
    makeConfigStore(
        enabled: true,
        mode: "custom",
        customTimeFrom: "2026-06-16T03:04:05.000Z"
    ).resolvedTimeThreshold() == customDate,
    "custom range must parse JS fractional ISO timestamps"
)

let allRangeOptions = PhotoScanner.defaultFetchOptions(
    configStore: makeConfigStore(enabled: true, mode: "all")
)
let allRangePredicate = allRangeOptions.predicate?.predicateFormat ?? ""
expect(
    allRangePredicate.contains("mediaType == 1"),
    "scanner predicate must include images"
)
expect(
    allRangePredicate.contains("mediaType == 2"),
    "scanner predicate must include videos"
)
expect(
    !allRangePredicate.contains("creationDate"),
    "scanner must not add creationDate filter for all range"
)

let disabledCustomOptions = PhotoScanner.defaultFetchOptions(
    configStore: makeConfigStore(
        enabled: false,
        mode: "custom",
        customTimeFrom: "2026-06-16T03:04:05.000Z"
    )
)
let disabledCustomPredicate = disabledCustomOptions.predicate?.predicateFormat ?? ""
expect(
    !disabledCustomPredicate.contains("creationDate"),
    "scanner must not add creationDate filter while auto upload is disabled"
)

let customRangeOptions = PhotoScanner.defaultFetchOptions(
    configStore: makeConfigStore(
        enabled: true,
        mode: "custom",
        customTimeFrom: "2026-06-16T03:04:05.000Z"
    )
)
let customRangePredicate = customRangeOptions.predicate?.predicateFormat ?? ""
expect(
    customRangePredicate.contains("mediaType == 1"),
    "range scanner predicate must still include images"
)
expect(
    customRangePredicate.contains("mediaType == 2"),
    "range scanner predicate must still include videos"
)
expect(
    customRangePredicate.contains("creationDate >="),
    "scanner must add creationDate threshold for configured range"
)
expect(
    customRangeOptions.sortDescriptors?.first?.key == "creationDate",
    "scanner must sort by creationDate"
)
expect(
    customRangeOptions.sortDescriptors?.first?.ascending == false,
    "scanner must scan newest assets first"
)
