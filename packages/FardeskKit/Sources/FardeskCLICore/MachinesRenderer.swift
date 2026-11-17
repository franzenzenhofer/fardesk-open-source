import FardeskModels
import FardeskStore

/// `fardesk machines`: name, online/offline, sessions count, version, Ghostty automation.
public enum MachinesRenderer {
    public static func render(_ machines: [MachineState], options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(machines.compactMap(\.machine))
        case .human: human(machines)
        }
    }

    private static func human(_ machines: [MachineState]) -> String {
        guard !machines.isEmpty else { return "No machines paired" }
        let rows = machines.map { state in
            [
                state.endpoint.name,
                ConnectionLabel.text(state.connection),
                String(state.sessions.count),
                state.machine?.version ?? "-",
                state.machine?.ghosttyAutomation.rawValue ?? "-",
            ]
        }
        let table = TextTable.render(header: ["NAME", "STATUS", "SESSIONS", "VERSION", "GHOSTTY"], rows: rows)
        let notes = machines.filter { $0.machine?.ghosttyAutomation == .denied }.map {
            "\($0.endpoint.name): allow Automation for Ghostty in System Settings > Privacy & Security > Automation"
        }
        return (table + notes).joined(separator: "\n")
    }
}

enum ConnectionLabel {
    static func text(_ connection: ConnectionState) -> String {
        switch connection {
        case .connecting: "connecting"
        case .online: "online"
        case .offline: "offline"
        case .loggedOut: "logged out"
        }
    }
}
