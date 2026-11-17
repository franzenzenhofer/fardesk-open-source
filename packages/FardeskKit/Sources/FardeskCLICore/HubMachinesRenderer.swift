import FardeskModels
import FardeskStore
import Foundation

/// `fardesk machines` in hub mode: the hub's own answer (`GET /v1/hub`), worded by the same
/// `MachinePresentation` the app's machines screen uses.
public enum HubMachinesRenderer {
    public static func render(_ state: HubState, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(state)
        case .human: human(state, now: options.now)
        }
    }

    private static func human(_ state: HubState, now: Date) -> String {
        let rows = state.machines.map { info -> [String] in
            let machine = MachinePresentation(hub: info, now: now)
            return [
                machine.name, machine.statusLabel, machine.lastSeenLabel ?? "-", machine.latencyLabel ?? "-",
                count(machine.sessions), count(machine.waiting), count(machine.working), machine.problem ?? "",
            ]
        }
        let header = ["NAME", "STATUS", "LAST SEEN", "LATENCY", "SESSIONS", "WAITING", "WORKING", "PROBLEM"]
        return TextTable.render(header: header, rows: rows).joined(separator: "\n")
    }

    private static func count(_ value: Int?) -> String { value.map(String.init) ?? "-" }
}
