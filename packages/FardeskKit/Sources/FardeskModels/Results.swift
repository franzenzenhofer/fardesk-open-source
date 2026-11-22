import Foundation

public struct ActionResult: Codable, Sendable, Hashable {
    public let sessionId: String
}

/// `{ "ok": true }`. Decoding `ok: false` fails.
public struct OkResult: Codable, Sendable, Hashable {
    private enum CodingKeys: String, CodingKey {
        case ok
    }

    public init(from decoder: any Decoder) throws {
        let ok = try decoder.container(keyedBy: CodingKeys.self).decode(Bool.self, forKey: .ok)
        guard ok else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "OkResult.ok must be true")
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(true, forKey: .ok)
    }
}

/// The answer to a message: `queued` is true when a busy session has not read it yet and will after its current turn.
public struct MessageResult: Codable, Sendable, Hashable {
    private enum CodingKeys: String, CodingKey {
        case ok, queued
    }

    /// Absent on the wire when the message was delivered at once.
    public let queued: Bool?

    public var isQueued: Bool { queued ?? false }

    public init(queued: Bool?) {
        self.queued = queued
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(Bool.self, forKey: .ok) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "MessageResult.ok must be true")
            )
        }
        queued = try container.decodeIfPresent(Bool.self, forKey: .queued)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(true, forKey: .ok)
        try container.encodeIfPresent(queued, forKey: .queued)
    }
}

public struct ErrorBody: Codable, Sendable, Hashable {
    public let code: ErrorCode
    public let message: String

    public init(code: ErrorCode, message: String) {
        self.code = code
        self.message = message
    }
}

public struct ErrorResponse: Codable, Sendable, Hashable {
    public let error: ErrorBody

    public init(error: ErrorBody) {
        self.error = error
    }
}

/// A stopped chat the user removed from the list (Settings, Hidden chats): enough to recognise it and bring it back.
public struct HiddenSession: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let cwd: String
    public let updatedAt: Date

    public init(id: String, title: String, cwd: String, updatedAt: Date) {
        self.id = id
        self.title = title
        self.cwd = cwd
        self.updatedAt = updatedAt
    }
}

/// `GET /v1/sessions/hidden`.
public struct HiddenSessionList: Codable, Sendable, Hashable {
    public let sessions: [HiddenSession]
}
