import Foundation

/// Contract name `HubMachine`: how the hub last saw one machine. The hub itself is first.
public struct HubMachine: Codable, Sendable, Hashable {
    public let name: String
    public let online: Bool
    public let hub: Bool
    public let lastSeen: Date?
    public let latencyMs: Int?
    /// Why the machine is offline, in plain words; nil when online.
    public let problem: String?
    /// The technical cause behind `problem` ("connection refused (ECONNREFUSED)"), for diagnostics; nil when online.
    public let detail: String?
    public let sessions: Int
    public let waiting: Int
    public let working: Int
    /// The machine's operating system; nil from a hub that does not say yet.
    public let os: MachineOS?

    public init(
        name: String, online: Bool, hub: Bool = false, lastSeen: Date? = nil, latencyMs: Int? = nil,
        problem: String? = nil, detail: String? = nil, sessions: Int = 0, waiting: Int = 0, working: Int = 0,
        os: MachineOS? = nil
    ) {
        self.name = name
        self.online = online
        self.hub = hub
        self.lastSeen = lastSeen
        self.latencyMs = latencyMs
        self.problem = problem
        self.detail = detail
        self.sessions = sessions
        self.waiting = waiting
        self.working = working
        self.os = os
    }

    /// Whether a screen would draw the same for both: the latency counts in steps of 100 ms (a live reading jitters on every
    /// poll), the last-seen time only while the machine is offline.
    public func sameDisplay(as other: HubMachine) -> Bool {
        name == other.name && online == other.online && hub == other.hub && problem == other.problem
            && os == other.os && sessions == other.sessions && waiting == other.waiting && working == other.working
            && latencyMs.map { $0 / 100 } == other.latencyMs.map { $0 / 100 }
            && (online || lastSeen == other.lastSeen)
    }

    private enum CodingKeys: String, CodingKey {
        case name, online, hub, lastSeen, latencyMs, problem, detail, sessions, waiting, working, os
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        online = try c.decode(Bool.self, forKey: .online)
        hub = try c.decode(Bool.self, forKey: .hub)
        lastSeen = try c.decode(Date?.self, forKey: .lastSeen)
        latencyMs = try c.decode(Int?.self, forKey: .latencyMs)
        problem = try c.decode(String?.self, forKey: .problem)
        detail = try c.decode(String?.self, forKey: .detail)
        sessions = try c.decode(Int.self, forKey: .sessions)
        waiting = try c.decode(Int.self, forKey: .waiting)
        working = try c.decode(Int.self, forKey: .working)
        os = try c.decodeIfPresent(MachineOS.self, forKey: .os)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(online, forKey: .online)
        try c.encode(hub, forKey: .hub)
        try c.encode(lastSeen, forKey: .lastSeen)
        try c.encode(latencyMs, forKey: .latencyMs)
        try c.encode(problem, forKey: .problem)
        try c.encode(detail, forKey: .detail)
        try c.encode(sessions, forKey: .sessions)
        try c.encode(waiting, forKey: .waiting)
        try c.encode(working, forKey: .working)
        try c.encodeIfPresent(os, forKey: .os)
    }
}

/// Contract name `HubState`: `GET /v1/hub`, the single source of truth for "is machine X online".
public struct HubState: Codable, Sendable, Hashable {
    public let hub: String
    public let checkedAt: Date
    public let machines: [HubMachine]

    public init(hub: String, checkedAt: Date, machines: [HubMachine]) {
        self.hub = hub
        self.checkedAt = checkedAt
        self.machines = machines
    }
}
