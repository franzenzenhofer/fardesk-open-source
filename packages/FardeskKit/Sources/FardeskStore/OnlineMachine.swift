import Foundation

/// An online machine as the New Session sheet needs it: who it is, which models it offers and which
/// safety switches its daemon has on (older daemons do not say: both are then true).
public struct OnlineMachine: Equatable, Sendable, Identifiable {
    public let id: UUID
    public let name: String
    public let models: [String]
    /// The daemon accepts sessions in bypassPermissions (config `owned.allowBypass`).
    public let allowBypass: Bool
    /// The daemon runs a Coordinator (config `coordinator.enabled`).
    public let coordinatorEnabled: Bool
    /// The names of the daemon's Claude homes; the New Session sheet asks which one when there are several.
    public let homes: [String]

    public init(id: UUID, name: String, models: [String], allowBypass: Bool = true, coordinatorEnabled: Bool = true, homes: [String] = []) {
        self.id = id
        self.name = name
        self.models = models
        self.allowBypass = allowBypass
        self.coordinatorEnabled = coordinatorEnabled
        self.homes = homes
    }
}

extension OnlineMachine {
    init(state: MachineState) {
        self.init(
            id: state.id, name: state.endpoint.name, models: state.machine?.models ?? [],
            allowBypass: state.machine?.allowBypass ?? true, coordinatorEnabled: state.machine?.coordinatorEnabled ?? true,
            homes: state.machine?.homes ?? [])
    }
}
