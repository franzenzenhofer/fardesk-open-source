import Foundation

/// Whether the app is in front of the owner.
public enum AppActivity: Equatable, Sendable {
    case active
    /// Inactive or in the background: the owner is not using the app.
    case away
}

/// Decides when the owner has been away long enough that the held list order may follow the freshest chats.
/// Pure: the caller passes the time of every change, so tests need no real clock.
public struct ReturnAfterPause: Equatable, Sendable {
    /// Away at least this long, then back: the list order is refreshed. Shorter: the list stays as it is.
    public static let refreshAfterAbsence: TimeInterval = 120

    private var awaySince: Date?

    public init() {}

    /// Records a change of activity; true when the owner just came back after at least `refreshAfterAbsence`.
    public mutating func note(_ activity: AppActivity, at time: Date) -> Bool {
        switch activity {
        case .away:
            if awaySince == nil { awaySince = time }
            return false
        case .active:
            defer { awaySince = nil }
            guard let since = awaySince else { return false }
            return time.timeIntervalSince(since) >= Self.refreshAfterAbsence
        }
    }
}
