import FardeskModels
import Foundation

/// What the newest activity row of a followed session is, as far as the stop decision cares.
enum FollowRowKind: Sendable, Equatable {
    case assistantText
    case other

    init(_ activity: Activity?) {
        if case .assistant = activity { self = .assistantText } else { self = .other }
    }
}

/// Why a followed session's turn is over, or that it is not.
enum FollowStop: Sendable, Equatable {
    case keepGoing
    case needsYou
    case turnEnded
    case timedOut

    /// How long the status must stay non-working before an assistant text row ends the turn.
    static let settleTime: TimeInterval = 3
    /// Default hard limit for following one turn.
    static let defaultTimeout: TimeInterval = 600

    /// Short idle gaps between tool calls do not end a turn: only a waiting session, a settled idle/ended
    /// session whose newest row is assistant text, or the hard timeout does.
    static func decide(
        status: SessionStatus,
        lastRowKind: FollowRowKind,
        nonWorkingSince: Date?,
        now: Date,
        startedAt: Date,
        timeout: TimeInterval = defaultTimeout
    ) -> FollowStop {
        if status == .waiting { return .needsYou }
        if status != .working, lastRowKind == .assistantText,
           let since = nonWorkingSince, now.timeIntervalSince(since) >= settleTime { return .turnEnded }
        return now.timeIntervalSince(startedAt) >= timeout ? .timedOut : .keepGoing
    }

    /// The command that settles the newest pending permission or question of a session.
    static func hint(for rows: [Activity], sessionID: String) -> String? {
        let short = ShortID.short(sessionID)
        for row in rows.reversed() {
            switch row {
            case .permission(let a) where a.state == .pending:
                return "Needs you: fardesk approve \(short) \(a.requestId)"
            case .question(let a) where a.state == .pending:
                let choice = a.options.isEmpty ? "<answer>" : "<\(a.options.joined(separator: "|"))>"
                return "Needs you: fardesk answer \(short) \(choice) \(a.requestId)"
            default: continue
            }
        }
        return nil
    }
}
