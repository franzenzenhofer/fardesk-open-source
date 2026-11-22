import FardeskModels
import Foundation

/// Every fact the app knows about a session, as label and value lines for the session info sheet.
public struct SessionFacts: Equatable, Sendable {
    public struct Row: Equatable, Sendable {
        public let label: String
        public let value: String
    }

    public let rows: [Row]

    public init(session: SessionSummary, machineName: String, now: Date = .now) {
        let presentation = SessionPresentation(session: session, now: now)
        var rows = [
            Row(label: "Status", value: presentation.subtitleParts.joined(separator: ": ")),
            Row(label: "Agent", value: session.agent.displayName),
            Row(label: "Machine", value: machineName),
            Row(label: "Started in", value: session.cwd),
        ]
        // The Claude home (account folder, e.g. .claude or .claude-team): shown here, never in the list.
        if let home = session.home { rows.append(Row(label: "Claude home", value: home)) }
        if let mode = session.permissionMode { rows.append(Row(label: "Mode", value: mode.label)) }
        if let model = session.model { rows.append(Row(label: "Model", value: model)) }
        if let tokens = session.contextTokens { rows.append(Row(label: "Context", value: "\(tokens.formatted()) tokens")) }
        rows += [
            Row(label: "Started", value: Self.time(session.startedAt)),
            Row(label: "Last activity", value: Self.time(session.updatedAt)),
            Row(label: "Runs in", value: session.owned ? "Fardesk (no terminal)" : "a terminal"),
            Row(label: "Notifications", value: session.muted ? "Muted" : "On"),
            Row(label: "Session ID", value: session.id),
        ]
        if let pid = session.pid { rows.append(Row(label: "Process", value: String(pid))) }
        self.rows = rows
    }

    private static func time(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}
