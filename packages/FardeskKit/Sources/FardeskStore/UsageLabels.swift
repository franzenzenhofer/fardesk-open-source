import Foundation

/// Short labels for sizes and durations in the words of Claude Code's own dialogs.
public enum UsageLabels {
    /// "426k", "1.2M", "950".
    public static func tokens(_ count: Int) -> String {
        switch count {
        case ..<1_000: "\(count)"
        case ..<1_000_000: "\(Int((Double(count) / 1_000).rounded()))k"
        default: String(format: "%.1fM", Double(count) / 1_000_000)
        }
    }

    /// "5 min", "3 h", "2 d".
    public static func idle(since last: Date, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(last) / 60))
        switch minutes {
        case ..<60: return "\(max(1, minutes)) min"
        case ..<(60 * 24): return "\(minutes / 60) h"
        default: return "\(minutes / (60 * 24)) d"
        }
    }
}
