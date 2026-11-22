import Foundation

public struct MessageRequest: Codable, Sendable, Hashable {
    public let text: String
    /// Attachment ids from `POST /v1/sessions/:id/attachments`; absent on the wire when none.
    public let attachments: [String]?

    public init(text: String, attachments: [String]? = nil) {
        self.text = text
        self.attachments = attachments
    }
}

/// Contract name `PermissionRequest`: the body that decides a pending permission.
public struct PermissionDecisionRequest: Codable, Sendable, Hashable {
    public let decision: PermissionDecision
    /// The feedback for `revise`; absent on the wire for every other decision.
    public let message: String?

    public init(decision: PermissionDecision, message: String? = nil) {
        self.decision = decision
        self.message = message
    }
}

public struct AnswerRequest: Codable, Sendable, Hashable {
    public let option: String

    public init(option: String) {
        self.option = option
    }
}

/// Body that sends a prompt to the coordinator session.
public struct CoordinatorRequest: Codable, Sendable, Hashable {
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }
}

/// Contract name `CoordinatorState`: the coordinator session of this machine, or none yet.
/// The key is always present: `{"sessionId": null}` when no coordinator session exists.
public struct CoordinatorState: Codable, Sendable, Hashable {
    public let sessionId: String?

    public init(sessionId: String?) {
        self.sessionId = sessionId
    }

    private enum CodingKeys: String, CodingKey {
        case sessionId
    }

    public init(from decoder: any Decoder) throws {
        sessionId = try decoder.container(keyedBy: CodingKeys.self).decode(String?.self, forKey: .sessionId)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
    }
}

public struct MuteRequest: Codable, Sendable, Hashable {
    public let muted: Bool

    public init(muted: Bool) {
        self.muted = muted
    }
}

public struct NewSessionRequest: Codable, Sendable, Hashable {
    public let cwd: String
    public let prompt: String
    public let worktree: Bool
    public let model: String?
    /// Absent = the machine's default (config `owned.permissionMode`, "Ask" unless the owner changed it).
    public let permissionMode: PermissionMode?
    /// The name of one of `Machine.homes`; absent = the machine's first home.
    public let home: String?

    public init(cwd: String, prompt: String, worktree: Bool, model: String?, permissionMode: PermissionMode? = nil, home: String? = nil) {
        self.cwd = cwd
        self.prompt = prompt
        self.worktree = worktree
        self.model = model
        self.permissionMode = permissionMode
        self.home = home
    }

    private enum CodingKeys: String, CodingKey {
        case cwd, prompt, worktree, model, permissionMode, home
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cwd = try c.decode(String.self, forKey: .cwd)
        prompt = try c.decode(String.self, forKey: .prompt)
        worktree = try c.decode(Bool.self, forKey: .worktree)
        model = try c.decode(String?.self, forKey: .model)
        permissionMode = try c.decodeIfPresent(PermissionMode.self, forKey: .permissionMode)
        home = try c.decodeIfPresent(String.self, forKey: .home)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(cwd, forKey: .cwd)
        try c.encode(prompt, forKey: .prompt)
        try c.encode(worktree, forKey: .worktree)
        try c.encode(model, forKey: .model)
        try c.encodeIfPresent(permissionMode, forKey: .permissionMode)
        try c.encodeIfPresent(home, forKey: .home)
    }
}

public struct DeviceRequest: Codable, Sendable, Hashable {
    public let apnsToken: String
    public let environment: APNsEnvironment
    public let name: String
    public let notifications: [NotificationType]

    public init(apnsToken: String, environment: APNsEnvironment, name: String, notifications: [NotificationType]) {
        self.apnsToken = apnsToken
        self.environment = environment
        self.name = name
        self.notifications = notifications
    }
}
