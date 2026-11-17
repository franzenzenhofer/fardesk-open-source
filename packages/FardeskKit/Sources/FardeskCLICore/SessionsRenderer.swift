import FardeskModels
import FardeskStore

/// `fardesk sessions`: one block per machine, rows in the app's order.
public enum SessionsRenderer {
    private struct Envelope: Encodable {
        let machine: String
        let session: SessionSummary
    }

    private struct Block {
        let header: String
        let rows: [[String]]
    }

    public static func render(_ machines: [MachineState], options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try json(machines)
        case .human: human(machines, options: options)
        }
    }

    private static func json(_ machines: [MachineState]) throws -> String {
        let envelopes = machines.flatMap { state in
            SessionOrdering.sorted(state.sessions).map { Envelope(machine: state.endpoint.name, session: $0) }
        }
        return try JSONOutput.compact(envelopes)
    }

    private static func human(_ machines: [MachineState], options: RenderOptions) -> String {
        guard !machines.isEmpty else { return "No machines paired" }
        let blocks = machines.map { block($0, options: options) }
        let widths = TextTable.widths(of: blocks.flatMap(\.rows))
        return blocks.map { block in
            let lines = block.rows.isEmpty
                ? ["  (no sessions)"]
                : block.rows.map { "  " + TextTable.format($0, widths: widths) }
            return ([block.header] + lines).joined(separator: "\n")
        }.joined(separator: "\n\n")
    }

    private static func block(_ state: MachineState, options: RenderOptions) -> Block {
        let rows = SessionOrdering.sorted(state.sessions).map { session -> [String] in
            let presentation = SessionPresentation(session: session, now: options.now)
            return [
                session.status.marker,
                session.title,
                presentation.subtitleParts.joined(separator: " - "),
                presentation.relativeTime,
                ShortID.short(session.id),
            ]
        }
        return Block(header: header(state, options: options), rows: rows)
    }

    private static func header(_ state: MachineState, options: RenderOptions) -> String {
        let name = state.endpoint.name
        switch state.connection {
        case .connecting: return "\(name)  Connecting"
        case .online: return "\(name)  Online"
        case .loggedOut: return "\(name)  Logged out"
        case .offline(let lastSeen):
            guard let lastSeen else { return "\(name)  Offline" }
            let ago = RelativeTimeFormat.short(from: lastSeen, to: options.now)
            let seen = ago == "Now" ? "just now" : "\(ago) ago"
            return "\(name)  Offline - last seen \(seen)"
        }
    }
}

extension SessionStatus {
    /// ASCII status marker for the CLI (the app uses SF Symbols).
    var marker: String {
        switch self {
        case .waiting: "!"
        case .working: "~"
        case .idle: "-"
        case .ended: "x"
        }
    }
}
