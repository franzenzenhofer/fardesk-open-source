import FardeskModels
import Foundation

public enum ComposerMode: Equatable, Sendable {
    case composer
    case takeover(label: String)
    case resume(label: String)

    public init(replyMode: ReplyMode) {
        switch replyMode {
        case .composer, .unknown: self = .composer
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
        symbolName = SessionRowGlyph(session: session).symbolName
        relativeTime = RelativeTimeFormat.short(from: session.updatedAt, to: now)
        folderLabel = FolderLabel.shortened(session.cwd)
        composerMode = ComposerMode(replyMode: session.replyMode)
        terminalCommand = "claude --resume \(session.id)"
    }

    /// The one status word (docs/design/STATES.md): what the session does, in words a non-specialist reads at a glance.
    static func statusLabel(for session: SessionSummary) -> String {
        switch (session.status, session.waitingFor) {
        case (.waiting, .terminal?): "Needs you at the computer"
        case (.waiting, .permission?): "Needs your approval"
        case (.waiting, .question?), (.waiting, .dialog?): "Needs your answer"
        case (.waiting, .unknown?), (.waiting, nil): "Needs you"
        case (.working, _): "Working"
        case (.idle, _) where session.background > 0: "In background"
        case (.idle, _): "Your turn"
        case (.ended, _): "Stopped"
        case (.unknown, _): unknownStateText
        }
    }

    /// The status word, then one short sentence when there is something to say: what it works on, which dialog waits
    /// at the computer, or the last line of the answer. A stopped session says only that it stopped.
    private static func subtitleParts(for session: SessionSummary, statusLabel: String) -> [String] {
        let detail = detail(of: session)
        return detail.isEmpty ? [statusLabel] : [statusLabel, detail]
    }

    private static let computerWaitPrefix = "Needs you at the computer"

    static func detail(of session: SessionSummary) -> String {
        let summary = session.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        switch session.status {
        case .working, .idle, .unknown: return summary
        case .ended: return ""
        case .waiting:
            // The daemon names a terminal dialog as "Needs you at the computer: <dialog>"; keep only the dialog.
            guard session.waitingFor == .terminal, summary.hasPrefix(computerWaitPrefix) else { return "" }
            return String(summary.dropFirst(computerWaitPrefix.count)).trimmingCharacters(in: CharacterSet(charactersIn: ": ").union(.whitespaces))
        }
    }
}
