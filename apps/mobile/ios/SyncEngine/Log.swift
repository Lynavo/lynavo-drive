import Foundation

// MARK: - Timestamped logging

/// Internal timestamp source. Uses a fixed ISO-ish format that is:
/// - Lexicographically sortable (`yyyy-MM-dd HH:mm:ss.SSS`)
/// - Local-time, since developers reading Xcode console think in local time
/// - Locale-independent (`en_US_POSIX`), so month/day formatting never changes
enum Log {
    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        return formatter
    }()

    static func timestamp() -> String {
        timestampFormatter.string(from: Date())
    }
}

/// Drop-in replacement for `NSLog` that prepends a timestamp to every line.
///
/// Xcode 16's Debug console hides NSLog's default timestamp column, and some
/// device log viewers also trim it, so we bake the timestamp into the message
/// body. Underlying sink is still `NSLog` so lines continue to flow through
/// Apple Unified Logging (visible in Console.app and `sysdiagnose`).
///
/// Usage is identical to NSLog:
/// ```
/// slog("[TcpTransport] connected to %@:%d", host, port)
/// ```
func slog(_ format: String, _ args: CVarArg...) {
    let stamp = Log.timestamp()
    let body: String
    if args.isEmpty {
        body = format
    } else {
        body = String(format: format, locale: nil, arguments: args)
    }
    NSLog("%@", "[\(stamp)] \(body)")
}
