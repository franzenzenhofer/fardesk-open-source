import Foundation

/// Body of `POST /v1/notifications/pause`: 0 to 10080 minutes (0 resumes).
public struct NotificationPauseRequest: Codable, Sendable, Hashable {
    public let minutes: Int

    public init(minutes: Int) {
        self.minutes = minutes
    }
}

/// Answer of `GET /v1/notifications` and of the pause call: `pausedUntil` is null when pushes flow.
public struct NotificationState: Codable, Sendable, Hashable {
    public let pausedUntil: Date?

    public init(pausedUntil: Date?) {
        self.pausedUntil = pausedUntil
    }

    private enum CodingKeys: String, CodingKey {
        case pausedUntil
    }

    public init(from decoder: any Decoder) throws {
        pausedUntil = try decoder.container(keyedBy: CodingKeys.self).decode(Date?.self, forKey: .pausedUntil)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(pausedUntil, forKey: .pausedUntil)
    }
}
