import Foundation

/// "Now", "12s", "2m", "1h", "3d" as in mockup 01.
public enum RelativeTimeFormat {
    private static let nowBelowSeconds = 10
    private static let secondsPerMinute = 60
    private static let secondsPerHour = 3_600
    private static let secondsPerDay = 86_400

    public static func short(from start: Date, to end: Date) -> String {
        let seconds = Int(end.timeIntervalSince(start))
        switch seconds {
        case ..<nowBelowSeconds: return "Now"
        case ..<secondsPerMinute: return "\(seconds)s"
        case ..<secondsPerHour: return "\(seconds / secondsPerMinute)m"
        case ..<secondsPerDay: return "\(seconds / secondsPerHour)h"
        default: return "\(seconds / secondsPerDay)d"
        }
    }
}

/// `/Users/<x>/dev/app` and `/home/<x>/dev/app` become `~/dev/app`.
public enum FolderLabel {
    private static let homeRoots: Set<Substring> = ["Users", "home"]

    public static func shortened(_ cwd: String) -> String {
        let parts = cwd.split(separator: "/")
        guard cwd.hasPrefix("/"), parts.count >= 2, homeRoots.contains(parts[0]) else { return cwd }
        let rest = parts.dropFirst(2)
        return rest.isEmpty ? "~" : "~/" + rest.joined(separator: "/")
    }
}
