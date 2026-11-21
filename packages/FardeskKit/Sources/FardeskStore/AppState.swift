import FardeskModels
import Foundation

public enum AppStateError: Error, Equatable, Sendable, LocalizedError {
    case unknownMachine(UUID)

    public var errorDescription: String? {
        switch self {
        case .unknownMachine(let id): "No machine with id \(id.uuidString) in the app state"
        }
    }
}

/// A session that is waiting for the human, with the machine it lives on.
public struct NeedsYouItem: Equatable, Sendable {
    public let machineID: UUID
    public let machineName: String
    public let session: SessionSummary
}

/// All machines in list order. Events from the clients flow in through `apply`.
public struct AppState: Equatable, Sendable {
    public private(set) var machines: [MachineState]
    /// Machine names the owner wants first, in this order (empty = alphabetical).
    public let machineOrder: [String]

    public init(machines: [MachineState] = [], machineOrder: [String] = []) {
        self.machineOrder = machineOrder
        self.machines = machines
    }

    public init(endpoints: [MachineEndpoint], machineOrder: [String] = []) {
        self.init(machines: MachineOrdering.sorted(endpoints.map(MachineState.init(endpoint:)), preferred: machineOrder), machineOrder: machineOrder)
    }

    /// Follows a changed machine list: keeps the state of machines still present, adds new ones.
    public mutating func sync(endpoints: [MachineEndpoint]) {
        let kept = endpoints.map { endpoint in
            if let known = machines.first(where: { $0.endpoint == endpoint }) { return known }
            return MachineState(endpoint: endpoint)
        }
        machines = MachineOrdering.sorted(kept, preferred: machineOrder)
    }

    /// The hub's OS answer or a hello can change a machine's rank.
    private mutating func reorder() {
        let ordered = MachineOrdering.sorted(machines, preferred: machineOrder)
        if ordered.map(\.id) != machines.map(\.id) { machines = ordered }
    }

    private var pause = ReturnAfterPause()
    /// Machines whose next hello (the fresh state after coming back) must also apply the held order.
    private var releaseOnNextHello = Set<UUID>()

    public mutating func releaseHeldOrder() {
        for index in machines.indices { machines[index].releaseHeldOrder() }
    }

    /// The app became active or went away. Coming back after a pause applies the held moves now and again with
    /// each machine's next hello; any shorter absence changes nothing.
    public mutating func noteActivity(_ activity: AppActivity, at time: Date) {
        guard pause.note(activity, at: time) else { return }
        releaseHeldOrder()
        releaseOnNextHello = Set(machines.map(\.id))
    }

    public mutating func restore(_ snapshot: MachineSnapshot) throws {
        try update(snapshot.machineID) { $0.restore(snapshot) }
        reorder()
    }

    public func machine(id: UUID) throws -> MachineState {
        guard let state = machines.first(where: { $0.id == id }) else {
            throw AppStateError.unknownMachine(id)
        }
        return state
    }

    public mutating func apply(_ event: StreamEvent, from machineID: UUID) throws {
        try update(machineID) { $0.apply(event) }
        if case .hello = event {
            if releaseOnNextHello.remove(machineID) != nil { try update(machineID) { $0.releaseHeldOrder() } }
            reorder()
        }
    }

    public mutating func markOffline(machineID: UUID, now: Date) throws {
        try update(machineID) { $0.markOffline(now: now) }
    }

    public mutating func markFailed(machineID: UUID, by error: any Error, now: Date) throws {
        try update(machineID) { $0.markFailed(by: error, now: now) }
    }

    public mutating func markConnecting(machineID: UUID) throws {
        try update(machineID) { $0.markConnecting() }
    }

    public mutating func apply(hub info: HubMachine, on machineID: UUID) throws {
        try update(machineID) { $0.apply(hub: info) }
        reorder()
    }

    public mutating func markOffline(machineID: UUID, problem: String, now: Date) throws {
        try update(machineID) { $0.markOffline(problem: problem, now: now) }
    }

    /// Sessions with status waiting on online machines, ordered like the list.
    public var needsYouSessions: [NeedsYouItem] {
        machines.filter(\.isOnline).flatMap { state in
            SessionOrdering.sorted(state.sessions.filter { $0.status == .waiting }).map {
                NeedsYouItem(machineID: state.id, machineName: state.endpoint.name, session: $0)
            }
        }
    }

    /// The latest end of a pause among the machines whose pause is still running (nil = none paused).
    public func pausedUntil(now: Date) -> Date? {
        machines.compactMap(\.pausedUntil).filter { $0 > now }.max()
    }

    public mutating func setPause(_ until: Date?, on machineID: UUID) throws {
        try update(machineID) { $0.setPause(until) }
    }

    public var needsYouCount: Int { needsYouSessions.count }

    private mutating func update(_ machineID: UUID, _ change: (inout MachineState) -> Void) throws {
        guard let index = machines.firstIndex(where: { $0.id == machineID }) else {
            throw AppStateError.unknownMachine(machineID)
        }
        change(&machines[index])
    }
}
