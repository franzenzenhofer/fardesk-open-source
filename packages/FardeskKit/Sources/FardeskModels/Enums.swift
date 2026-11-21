public enum SessionStatus: String, Codable, Sendable, Hashable {
    case working, waiting, idle, ended
}

/// What a waiting session needs. A permission or question is a request the phone can answer; a terminal wait is a
/// dialog open at the computer that only the terminal can answer.
public enum WaitingReason: String, Codable, Sendable, Hashable {
    case permission, question, terminal

    /// The phone can answer it, so a message typed meanwhile waits for that answer.
    public var phoneCanAnswer: Bool { self != .terminal }
}

public enum ReplyMode:String, Codable, Sendable, Hashable {
    case composer, takeover, resume
}

public enum ToolStatus: String, Codable, Sendable, Hashable {
    case running, ok, error
}

public enum PermissionState: String, Codable, Sendable, Hashable {
    case pending, allowed, denied, expired
}

public enum QuestionState: String, Codable, Sendable, Hashable {
    case pending, answered, expired
}

public enum PermissionDecision: String, Codable, Sendable, Hashable {
    case allow, deny
    case allowAlways = "allow_always"
}

public enum MachineOS: String, Codable, Sendable, Hashable {
    case macos, linux
}

public enum APNsEnvironment: String, Codable, Sendable, Hashable {
    case sandbox, production
}

public enum NotificationType: String, Codable, Sendable, Hashable {
    case done, permission, question, ended
}

public enum ErrorCode: String, Codable, Sendable, Hashable {
    case unauthorized, conflict, unsupported, `internal`
    case tokenRevoked = "token_revoked"
    case rateLimited = "rate_limited"
    case invalidRequest = "invalid_request"
    case notFound = "not_found"
    case machineOffline = "machine_offline"
}

public enum DetailKind: String, Codable, Sendable, Hashable {
    case diff, output
}

public enum DiffSign: String, Codable, Sendable, Hashable {
    case context = " "
    case added = "+"
    case removed = "-"
}
