import Foundation

public enum StreamEvent: Codable, Sendable, Hashable {
    case hello(machine: Machine, sessions: [SessionSummary])
    case session(SessionSummary)
    case activity(sessionId: String, activity: Activity)
    case ping(ts: Date)
    /// An event type a newer daemon added; ignored.
    case unknown

    private enum EventType: String, Codable {
        case hello, session, activity, ping
    }

    private enum CodingKeys: String, CodingKey {
        case type, machine, sessions, session, sessionId, activity, ts
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawType = try c.decode(String.self, forKey: .type)
        switch EventType(rawValue: rawType) {
        case nil:
            self = .unknown
        case .hello?:
            self = .hello(
                machine: try c.decode(Machine.self, forKey: .machine),
                sessions: try c.decode([SessionSummary].self, forKey: .sessions)
            )
        case .session?:
            self = .session(try c.decode(SessionSummary.self, forKey: .session))
        case .activity?:
            self = .activity(
                sessionId: try c.decode(String.self, forKey: .sessionId),
                activity: try c.decode(Activity.self, forKey: .activity)
            )
        case .ping?:
            self = .ping(ts: try c.decode(Date.self, forKey: .ts))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .hello(let machine, let sessions):
            try c.encode(EventType.hello, forKey: .type)
            try c.encode(machine, forKey: .machine)
            try c.encode(sessions, forKey: .sessions)
        case .session(let session):
            try c.encode(EventType.session, forKey: .type)
            try c.encode(session, forKey: .session)
        case .activity(let sessionId, let activity):
            try c.encode(EventType.activity, forKey: .type)
            try c.encode(sessionId, forKey: .sessionId)
            try c.encode(activity, forKey: .activity)
        case .unknown:
            try c.encode("unknown", forKey: .type)
        case .ping(let ts):
            try c.encode(EventType.ping, forKey: .type)
            try c.encode(ts, forKey: .ts)
        }
    }
}
