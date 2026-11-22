import FardeskClient
import FardeskModels
import Foundation

public enum ConnectionState: Equatable, Sendable {
    case connecting
    case online
    case offline(lastSeen: Date?)
    /// The machine refused the token (revoked or invalid) or there is none: logging in again is the fix.
    case loggedOut
}

/// Everything the client knows about one machine. Mutated only by the pure `apply` reducer.
public struct MachineState: Equatable, Sendable, Identifiable {
    public let endpoint: MachineEndpoint
    public private(set) var connection: ConnectionState
    public private(set) var machine: Machine?
    public private(set) var sessions: [SessionSummary] {
        didSet { sortSessions(previous: oldValue) }
    }
    private var listOrder = SessionListOrder()
    /// The sessions in list order, kept sorted here so a view body never sorts: not ended, then ended.
    public private(set) var activeSessions: [SessionSummary] = []
    public private(set) var endedSessions: [SessionSummary] = []
    public private(set) var lastSeen: Date?
    /// What the hub last said about this machine (hub mode only); the status text comes from it.
    public private(set) var hubInfo: HubMachine?
    /// When this machine's pushes resume, if they are paused (nil = not paused).
    public private(set) var pausedUntil: Date?

    public var id: UUID { endpoint.id }

    public init(endpoint: MachineEndpoint) {
        self.endpoint = endpoint
        connection = .connecting
        machine = nil
        sessions = []
        lastSeen = nil
        hubInfo = nil
        pausedUntil = nil
    }

    /// The rows of the session list: live ones, then the recent ended ones the daemon lists, never the
    /// coordinator's own sessions (the Coordinator has its own row).
    public private(set) var listedSessions: [SessionSummary] = []

    /// The most recent ended sessions a machine lists; older ones are found through the Coordinator.
    public static let endedRowLimit = 10

    private mutating func sortSessions(previous: [SessionSummary]) {
        let immediate = listOrder.note(sessions, previous: previous)
        let sorted = SessionOrdering.listOrder(sessions, sortedAt: listOrder.sortedAt)
        activeSessions = sorted.filter { $0.status != .ended }
        endedSessions = Array(sorted.filter { $0.status == .ended }.prefix(Self.endedRowLimit))
        // Pinned rows first (any status, never cut by the ended limit), then the usual order.
        let pinned = sorted.filter(\.label.pinned)
        let rest = activeSessions + endedSessions
        let target = (pinned + rest.filter { !$0.label.pinned }).filter { !$0.isCoordinatorSession }
        listOrder.update(target: target.map(\.id), immediate: immediate)
        rebuildListedSessions()
    }

    private mutating func rebuildListedSessions() {
        let byID = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
        listedSessions = listOrder.shown.compactMap { byID[$0] }
    }

    /// Rows hold their place: only new rows, gone rows and rows that newly need the user (or were pinned) move.
    /// Applies the held moves now (pull to refresh, or back after a pause).
    public mutating func releaseHeldOrder() {
        listOrder.release()
        rebuildListedSessions()
    }

    /// Whether this event would change anything a screen shows. An unchanged poll, hello or ping must not wake
    /// the observers: a `ping` only matters when it moves the last-seen time by more than `lastSeenResolution`.
    public func wouldChange(by event: StreamEvent) -> Bool {
        switch event {
        case .hello(let machine, let sessions):
            return self.machine != machine || self.sessions != sessions || connection != .online
        case .session(let session):
            return sessions.first { $0.id == session.id } != session
        case .activity, .unknown:
            return false
        case .ping(let ts):
            return lastSeen.map { ts.timeIntervalSince($0) > Self.lastSeenResolution } ?? true
        }
    }

    public static let lastSeenResolution: TimeInterval = 30

    /// Same for the hub's answer about this machine.
    public func wouldChange(by info: HubMachine) -> Bool {
        var copy = self
        copy.apply(hub: info)
        guard copy.connection == connection, let known = hubInfo else { return true }
        return !known.sameDisplay(as: info)
    }

    public var isOnline: Bool { connection == .online }

    /// Activity rows are not machine state: they go to the `FeedStore`, so this reducer ignores them.
    public mutating func apply(_ event: StreamEvent) {
        switch event {
        case .hello(let machine, let sessions):
            self.machine = machine
            self.sessions = sessions
            connection = .online
        case .session(let session):
            upsert(session)
        case .activity, .unknown:
            break
        case .ping(let ts):
            lastSeen = ts
        }
    }

    public mutating func markConnecting() {
        connection = .connecting
    }

    /// Keeps the cached sessions; remembers when the machine was last heard from.
    public mutating func markOffline(now: Date) {
        switch connection {
        case .online: connection = .offline(lastSeen: lastSeen ?? now)
        case .connecting: connection = .offline(lastSeen: lastSeen)
        case .offline, .loggedOut: break
        }
    }

    /// A refused or missing token shows as logged out; any other failure as offline.
    public mutating func markFailed(by error: any Error, now: Date) {
        if error.meansLoggedOut {
            connection = .loggedOut
        } else {
            markOffline(now: now)
        }
    }

    /// The hub is the authority on whether a machine is online: its answer sets the connection.
    /// An offline machine keeps its cached sessions and shows the hub's problem text.
    public mutating func apply(hub info: HubMachine) {
        hubInfo = info
        if let seen = info.lastSeen { lastSeen = seen }
        if info.online {
            if connection != .online { connection = machine == nil ? .connecting : .online }
        } else {
            connection = .offline(lastSeen: info.lastSeen ?? lastSeen)
        }
    }

    /// A call answered `machine_offline`: offline, quietly, with the hub's sentence as the problem.
    /// The time shown is the hub's last contact with the machine, never this device's own clock.
    public mutating func markOffline(problem: String, now: Date) {
        let hubSeen = hubInfo?.lastSeen
        markOffline(now: now)
        if let hubSeen, case .offline = connection { connection = .offline(lastSeen: hubSeen) }
        hubInfo = HubMachine(name: endpoint.name, online: false, lastSeen: hubSeen ?? lastSeen, problem: problem)
    }

    public mutating func setPause(_ until: Date?) {
        pausedUntil = until
    }

    private mutating func upsert(_ session: SessionSummary) {
        guard let index = sessions.firstIndex(where: { $0.id == session.id }) else {
            sessions.append(session)
            return
        }
        sessions[index] = session
    }

    /// What survives a restart: the last known machine and sessions, without activity feeds.
    public var snapshot: MachineSnapshot {
        MachineSnapshot(machineID: id, machine: machine, sessions: sessions, lastSeen: lastSeen)
    }

    /// Shows the last known state as offline until the live connection delivers a hello.
    public mutating func restore(_ snapshot: MachineSnapshot) {
        machine = snapshot.machine
        sessions = snapshot.sessions
        lastSeen = snapshot.lastSeen
        connection = .offline(lastSeen: snapshot.lastSeen)
    }
}

public struct MachineSnapshot: Codable, Equatable, Sendable {
    public let machineID: UUID
    public let machine: Machine?
    public let sessions: [SessionSummary]
    public let lastSeen: Date?
}
