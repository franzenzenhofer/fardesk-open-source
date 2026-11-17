import FardeskModels
import Foundation

/// What the Live Activity of one pinned session shows (Dynamic Island and Lock Screen).
/// Built here so the mapping is tested once; the app only hands it to ActivityKit.
public struct LiveActivityContent: Codable, Hashable, Sendable {
    public let projectName: String
    public let machineName: String
    public let statusLabel: String
    public let isWaiting: Bool
    /// Title of the newest tool or files row, e.g. "Ran swift test"; nil before the first tool ran.
    public let lastToolTitle: String?

    public init(session: SessionSummary, machineName: String, lastToolTitle: String?) {
        projectName = session.title
        self.machineName = machineName
        statusLabel = SessionPresentation(session: session, now: .now).statusLabel
        isWaiting = session.status == .waiting
        self.lastToolTitle = lastToolTitle
    }

    public init(session: SessionSummary, machineName: String, feed: SessionFeed) {
        self.init(session: session, machineName: machineName, lastToolTitle: Self.lastToolTitle(in: feed))
    }

    /// The title of the newest tool or files row of a feed.
    public static func lastToolTitle(in feed: SessionFeed) -> String? {
        feed.activities.reversed().lazy.compactMap(toolTitle).first
    }

    /// The content for a pinned session, or nil when the session is idle or ended, or gone: the
    /// activity then ends. The feed lives outside the state, so its newest tool title comes along.
    public static func make(state: AppState, ref: SessionRef, lastToolTitle: String? = nil) -> LiveActivityContent? {
        guard let machine = try? state.machine(id: ref.machineID),
              let session = machine.sessions.first(where: { $0.id == ref.sessionID }),
              session.status == .working || session.status == .waiting
        else { return nil }
        return LiveActivityContent(session: session, machineName: machine.endpoint.name, lastToolTitle: lastToolTitle)
    }

    public static func make(state: AppState, ref: SessionRef, feed: SessionFeed) -> LiveActivityContent? {
        make(state: state, ref: ref, lastToolTitle: lastToolTitle(in: feed))
    }

    private static func toolTitle(_ activity: Activity) -> String? {
        switch activity {
        case .tool(let tool): tool.title
        case .files(let files): files.title
        default: nil
        }
    }
}
