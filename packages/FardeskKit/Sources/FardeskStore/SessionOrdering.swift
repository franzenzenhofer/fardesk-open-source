import FardeskModels

/// Waiting first, then working, idle, ended; newest first inside a group, then title.
public enum SessionOrdering {
    public static func sorted(_ sessions: [SessionSummary]) -> [SessionSummary] {
        sessions.sorted(by: precedes)
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
