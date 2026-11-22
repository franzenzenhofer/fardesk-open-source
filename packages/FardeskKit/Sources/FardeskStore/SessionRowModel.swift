import FardeskModels
import Foundation

/// The status badge on a row's agent avatar (owner design kit 2026-11-22, `public/docs/design/LIST-ROW.md`).
/// The avatar says which agent runs the session; this badge alone carries the state colour.
public enum SessionBadge: String, Equatable, Sendable, CaseIterable {
    case working
    case background
    case needsYou
    case yourTurn
    case stopped

    public init(session: SessionSummary) {
        switch session.status {
        case .working: self = .working
        case .waiting: self = .needsYou
        case .idle where session.background > 0: self = .background
        case .idle: self = .yourTurn
        case .ended, .unknown: self = .stopped
        }
    }

    /// While the agent runs, the time is "now" and says nothing: those rows leave the time out.
    public var showsTime: Bool { self != .working && self != .background }

    /// The badge colour from the kit; "needs you" (not in the kit) is the clear orange of the attention state.
    public var colourHex: UInt32 {
        switch self {
        case .working, .background: 0x297851
        case .needsYou: 0xD9480F
        case .yourTurn: 0x514A92
        case .stopped: 0x737680
        }
    }

    /// "In background" is outlined on a pale fill with green marks; every other badge is solid with white marks.
    public var isOutlined: Bool { self == .background }
}

/// Everything one list row shows, so the app and its tests read the same thing: title, the muted preview
/// ("Working · After that I'll fix the tasks file…"), the time, the badge, the pin.
public struct SessionRowModel: Equatable, Sendable {
    public let title: String
    public let preview: String
    public let time: String?
    public let badge: SessionBadge
    public let agent: AgentKind
    public let pinned: Bool
    /// One sentence for VoiceOver: the row is one button, the avatar, badge and pin are decorative.
    public let accessibilityLabel: String

    public static let separator = " · "

    public init(session: SessionSummary, now: Date) {
        let presentation = SessionPresentation(session: session, now: now)
        title = session.displayTitle
        badge = SessionBadge(session: session)
        agent = session.agent
        pinned = session.label.pinned
        preview = Self.preview(presentation.subtitleParts)
        time = badge.showsTime ? presentation.relativeTime : nil
        accessibilityLabel = [title, agent.displayName, preview, time, pinned ? "Pinned" : nil]
            .compactMap { $0 }
            .joined(separator: ", ")
    }

    /// The state word, then the newest line on one line: inner line breaks become spaces.
    static func preview(_ parts: [String]) -> String {
        parts.map { $0.split(whereSeparator: \.isNewline).joined(separator: " ") }
            .joined(separator: separator)
    }
}
