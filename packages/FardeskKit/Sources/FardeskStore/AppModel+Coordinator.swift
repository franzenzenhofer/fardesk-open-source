import FardeskModels
import Foundation

extension AppModel {
    /// The one place state changes are announced: the badge list changes only when it really changed, and the
    /// widget writer gets the new value (it debounces and writes off the main thread).
    func stateChanged() {
        Breadcrumbs.mark("state changed")
        defer { Breadcrumbs.mark("idle") }
        let items = state.needsYouSessions
        if items != needsYou { needsYou = items }
        let online = state.machines.filter(\.isOnline).map(OnlineMachine.init(state:))
        if online != onlineMachines { onlineMachines = online }
        updateConnectivityBanner()
        onStateChange?(state)
    }

    /// The Tailscale interface is read only when the machines' connections changed, never in a view body.
    private func updateConnectivityBanner() {
        let connections = state.machines.map(\.connection)
        guard connections != bannerConnections else { return }
        bannerConnections = connections
        let banner = ConnectivityBanner.decide(connections: connections, tailscaleIsOn: configuration.tailscaleIsOn)
        if banner != connectivityBanner { connectivityBanner = banner }
    }

    /// The machine the Coordinator runs on: the hub itself (its coordinator has tools for every peer).
    public var hubMachineID: UUID? {
        CoordinatorPresentation.defaultMachine(in: state.machines)?.id
    }

    /// False when the Coordinator's machine reports its Coordinator switched off; true while unknown (older daemons, no answer yet).
    public var coordinatorEnabled: Bool {
        CoordinatorPresentation.defaultMachine(in: state.machines)?.machine?.coordinatorEnabled ?? true
    }

    /// The key under which the Coordinator's first message and its steps are kept before its session exists.
    public var coordinatorPendingRef: SessionRef? {
        hubMachineID.map(SessionRef.pendingCoordinator(on:))
    }

    /// The Coordinator's session, once it exists.
    public var coordinatorRef: SessionRef? {
        guard let machine = hubMachineID, let id = coordinatorSessionID else { return nil }
        return SessionRef(machineID: machine, sessionID: id)
    }

    func setCoordinatorSession(_ id: String?) {
        guard id != coordinatorSessionID else { return }
        coordinatorSessionID = id
        configuration.cache.saveCoordinatorID(id)
    }

    /// Reads the coordinator's session id from the hub machine in the background; opening the screen never waits for it.
    public func refreshCoordinator() async {
        guard let machineID = hubMachineID else { return }
        let state = await perform(on: machineID, action: "read the coordinator", origin: .background) { try await $0.coordinatorState() }
        if let state { setCoordinatorSession(state.sessionId) }
    }

    /// The coordinator session of a machine; nil when none runs yet (or the machine did not answer).
    public func coordinatorSession(on machineID: UUID) async -> SessionRef? {
        let state = await perform(on: machineID, action: "read the coordinator", origin: .background) { try await $0.coordinatorState() }
        return state?.sessionId.map { SessionRef(machineID: machineID, sessionID: $0) }
    }

    /// Sends a prompt to the coordinator of a machine; the result is the session to open.
    public func askCoordinator(_ prompt: String, on machineID: UUID) async -> SessionRef? {
        let result = await perform(on: machineID, action: "ask the coordinator") { try await $0.askCoordinator(prompt: prompt) }
        return result.map { SessionRef(machineID: machineID, sessionID: $0.sessionId) }
    }
}
