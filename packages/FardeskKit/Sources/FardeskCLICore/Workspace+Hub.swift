import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// Hub mode: `machines.json` names a hub, one login covers every machine, and the machine list is
/// whatever `GET /v1/hub` says.
extension Workspace {
    /// A workspace whose machine list is fresh: in hub mode the hub is asked once (a hub that does
    /// not answer leaves the list from the last run).
    static func open(context: CLIContext, format: OutputFormat) async throws -> Workspace {
        let stored = try Workspace(context: context, format: format)
        guard stored.machines.hub != nil, let state = try? await stored.hubState() else { return stored }
        let fresh = stored.machinesList(from: state)
        try? stored.machinesFile.save(fresh)
        return try Workspace(context: context, format: format, machines: fresh)
    }

    /// What the hub says about every machine; the one source of "who is online".
    func hubState() async throws -> HubState {
        guard let endpoint = access.hubEndpoint else {
            throw CLIError.usage("No hub is set. Run `fardesk hub --set http://host:4780`.")
        }
        return try await call(endpoint, quick: true) { try await $0.hub() }
    }

    /// Where telemetry is read: the hub holds every machine's reports, so hub mode asks only the hub.
    func telemetryEndpoints(machine: String?) throws -> [MachineEndpoint] {
        if machine == nil, let hub = access.hubEndpoint { return [hub] }
        return try endpoints(machine: machine)
    }

    /// Where an error report goes: the hub in hub mode (it keeps every report), else the one machine.
    func reportEndpoint(machine: String?) throws -> MachineEndpoint {
        if machine == nil, let hub = access.hubEndpoint { return hub }
        return try singleEndpoint(machine: machine)
    }

    /// The machine list of a hub answer (the hub URL stays).
    func machinesList(from state: HubState) -> MachineList {
        var list = machines
        guard let hub = machines.hub else { return list }
        list.replaceEndpoints(HubIdentity.endpoints(of: state, hub: hub))
        return list
    }

    /// Writes the hub's machines into `machines.json`; used after a login so later commands know them.
    func saveHubMachines() async throws {
        try machinesFile.save(machinesList(from: try await hubState()))
    }
}
