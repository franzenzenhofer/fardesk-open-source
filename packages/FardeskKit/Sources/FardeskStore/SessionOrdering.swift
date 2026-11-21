import FardeskModels
import Foundation

/// Waiting first, then working, idle, ended; newest first inside a group, then title.
public enum SessionOrdering {
    public static func sorted(_ sessions: [SessionSummary]) -> [SessionSummary] {
        sessions.sorted(by: precedes)
    }

    /// The order of the session list: needs-you first, then live sessions (working and idle share one group, so a
    /// finished turn does not jump groups), then ended. Inside a group the newest `sortedAt` (the last event that
    /// matters to the user, never the daemon's per-line `updatedAt`) comes first, then title, then id.
    public static func listOrder(_ sessions: [SessionSummary], sortedAt: [String: Date]) -> [SessionSummary] {
        sessions.sorted { lhs, rhs in
            let (leftGroup, rightGroup) = (listGroup(lhs.status), listGroup(rhs.status))
            if leftGroup != rightGroup { return leftGroup < rightGroup }
            let (leftTime, rightTime) = (sortedAt[lhs.id] ?? lhs.updatedAt, sortedAt[rhs.id] ?? rhs.updatedAt)
            if leftTime != rightTime { return leftTime > rightTime }
            let (leftTitle, rightTitle) = (lhs.displayTitle.lowercased(), rhs.displayTitle.lowercased())
            if leftTitle != rightTitle { return leftTitle < rightTitle }
            return lhs.id < rhs.id
        }
    }

    private static func listGroup(_ status: SessionStatus) -> Int {
        switch status {
        case .waiting: 0
        case .working, .idle: 1
        case .ended: 2
        }
    }

    static func rank(_ status: SessionStatus) -> Int {
        switch status {
        case .waiting: 0
        case .working: 1
        case .idle: 2
        case .ended: 3
        }
    }

    static func precedes(_ lhs: SessionSummary, _ rhs: SessionSummary) -> Bool {
        if lhs.status != rhs.status { return rank(lhs.status) < rank(rhs.status) }
        if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
        let (leftTitle, rightTitle) = (lhs.displayTitle.lowercased(), rhs.displayTitle.lowercased())
        if leftTitle != rightTitle { return leftTitle < rightTitle }
        return lhs.id < rhs.id
    }
}
