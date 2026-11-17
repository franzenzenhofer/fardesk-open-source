import FardeskModels
import Foundation

public enum ComposerMode: Equatable, Sendable {
    case composer
    case takeover(label: String)
    case resume(label: String)

    public init(replyMode: ReplyMode) {
        switch replyMode {
        case .composer: self = .composer
        case .takeover: self = .takeover(label: "Take over to reply")
        case .resume: self = .resume(label: "Resume to reply")
        }
    }
}

/// How a session row reads (mockup 01). Shared by the CLI and the app so it is tested once.
public struct SessionPresentation: Equatable, Sendable {
    public let statusLabel: String
    /// The second line of the row; each front end joins the parts with its own separator.
    public let subtitleParts: [String]
    public let symbolName: String
    public let relativeTime: String
    public let folderLabel: String
    public let composerMode: ComposerMode
    /// The command that continues this session in a terminal on its machine.
    public let terminalCommand: String

    public init(session: SessionSummary, now: Date) {
        let label = Self.statusLabel(for: session)
        statusLabel = label
        subtitleParts = Self.subtitleParts(for: session, statusLabel: label)
        symbolName = Self.symbolName(for: session.status)
        relativeTime = RelativeTimeFormat.short(from: session.updatedAt, to: now)
        folderLabel = FolderLabel.shortened(session.cwd)
        composerMode = ComposerMode(replyMode: session.replyMode)
        terminalCommand = "claude --resume \(session.id)"
    }

    private static func statusLabel(for session: SessionSummary) -> String {
        switch (session.status, session.waitingFor) {
        case (.waiting, .permission): "Needs approval"
        case (.waiting, .question): "Needs answer"
        case (.waiting, nil): "Waiting"
        case (.working, _): "Working"
        case (.idle, _): "Idle"
        case (.ended, _): "Ended"
        }
    }

    private static func subtitleParts(for session: SessionSummary, statusLabel: String) -> [String] {
        let lead = session.status == .waiting || session.summary.isEmpty ? statusLabel : session.summary
        return session.status == .ended ? [lead, "Can resume"] : [lead]
    }

    private static func symbolName(for status: SessionStatus) -> String {
        switch status {
        case .waiting: FardeskSymbol.waiting
        case .working: FardeskSymbol.working
        case .idle: FardeskSymbol.idle
        case .ended: FardeskSymbol.ended
        }
    }
}
