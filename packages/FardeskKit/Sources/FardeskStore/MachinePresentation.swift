import FardeskModels
import Foundation

/// One machine as the machines screen of the app and `fardesk machines` show it: the status text
/// is made here once, so the app and the CLI cannot disagree.
public struct MachinePresentation: Equatable, Sendable {
    public let name: String
    public let statusLabel: String
    public let isOnline: Bool
    /// The colour of the status dot: green online, orange logged out, grey otherwise.
    public let state: StateTone
    public let lastSeenLabel: String?
    public let isDimmed: Bool
    /// Why an offline machine is offline, in the hub's words (hub mode only).
    public let problem: String?
    public let latencyLabel: String?
    public let sessions: Int?
    public let waiting: Int?
    public let working: Int?

    public init(machine: MachineState, now: Date) {
        let status = Self.status(of: machine.connection, now: now)
        name = machine.endpoint.name
        statusLabel = status.label
        isOnline = status.isOnline
        state = StateTone(connection: machine.connection)
        lastSeenLabel = status.lastSeen
        isDimmed = status.isDimmed
        let info = machine.hubInfo
        problem = status.isOnline ? nil : info?.problem
        latencyLabel = status.isOnline ? info?.latencyMs.map(Self.latency) : nil
        sessions = info?.sessions
        waiting = info?.waiting
        working = info?.working
    }

    /// A machine exactly as `GET /v1/hub` reports it (what `fardesk machines` prints in hub mode).
    public init(hub info: HubMachine, now: Date) {
        let connection: ConnectionState = info.online ? .online : .offline(lastSeen: info.lastSeen)
        let status = Self.status(of: connection, now: now)
        name = info.name
        statusLabel = status.label
        isOnline = info.online
        state = StateTone(connection: connection)
        lastSeenLabel = status.lastSeen
        isDimmed = status.isDimmed
        problem = info.online ? nil : info.problem
        latencyLabel = info.online ? info.latencyMs.map(Self.latency) : nil
        sessions = info.sessions
        waiting = info.waiting
        working = info.working
    }

    private struct Status {
        let label: String
        let isOnline: Bool
        let lastSeen: String?
        let isDimmed: Bool
    }

    private static func status(of connection: ConnectionState, now: Date) -> Status {
        switch connection {
        case .online: Status(label: "Online", isOnline: true, lastSeen: nil, isDimmed: false)
        case .connecting: Status(label: "Connecting", isOnline: false, lastSeen: nil, isDimmed: false)
        case .loggedOut: Status(label: "Logged out", isOnline: false, lastSeen: nil, isDimmed: true)
        case .offline(let lastSeen):
            Status(
                label: "Offline", isOnline: false,
                lastSeen: lastSeen.map { "Last seen \(RelativeTimeFormat.short(from: $0, to: now)) ago" }, isDimmed: true
            )
        }
    }

    private static func latency(_ milliseconds: Int) -> String { "\(milliseconds) ms" }
}
