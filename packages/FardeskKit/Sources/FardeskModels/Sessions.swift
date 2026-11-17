import Foundation

public struct Machine: Codable, Sendable, Hashable {
    public let contractVersion: ContractVersion
    public let name: String
    public let hostname: String
    public let os: MachineOS
    public let version: String
    public let claudeVersion: String?
    public let sessionsCount: Int
    public let models: [String]
    public let ghosttyAutomation: GhosttyAutomation
    /// False when the machine's `owned.allowBypass` is off: it refuses sessions in bypassPermissions (older daemons: true).
    public let allowBypass: Bool
    /// False when the machine's `coordinator.enabled` is off (older daemons: true).
    public let coordinatorEnabled: Bool
}

extension Machine {
    private enum CodingKeys: String, CodingKey {
        case contractVersion, name, hostname, os, version, claudeVersion, sessionsCount, models, ghosttyAutomation
        case allowBypass, coordinatorEnabled
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contractVersion = try c.decode(ContractVersion.self, forKey: .contractVersion)
        name = try c.decode(String.self, forKey: .name)
        hostname = try c.decode(String.self, forKey: .hostname)
        os = try c.decode(MachineOS.self, forKey: .os)
        version = try c.decode(String.self, forKey: .version)
        claudeVersion = try c.decode(String?.self, forKey: .claudeVersion)
        sessionsCount = try c.decode(Int.self, forKey: .sessionsCount)
        models = try c.decode([String].self, forKey: .models)
        ghosttyAutomation = try c.decode(GhosttyAutomation.self, forKey: .ghosttyAutomation)
        allowBypass = try c.decodeIfPresent(Bool.self, forKey: .allowBypass) ?? true
        coordinatorEnabled = try c.decodeIfPresent(Bool.self, forKey: .coordinatorEnabled) ?? true
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(contractVersion, forKey: .contractVersion)
        try c.encode(name, forKey: .name)
        try c.encode(hostname, forKey: .hostname)
        try c.encode(os, forKey: .os)
        try c.encode(version, forKey: .version)
        try c.encode(claudeVersion, forKey: .claudeVersion)
        try c.encode(sessionsCount, forKey: .sessionsCount)
        try c.encode(models, forKey: .models)
        try c.encode(ghosttyAutomation, forKey: .ghosttyAutomation)
        try c.encode(allowBypass, forKey: .allowBypass)
        try c.encode(coordinatorEnabled, forKey: .coordinatorEnabled)
    }
}

public struct SessionSummary: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let cwd: String
    public let status: SessionStatus
    public let waitingFor: WaitingReason?
    public let owned: Bool
    public let replyMode: ReplyMode
    public let canStop: Bool
    public let summary: String
    public let model: String?
    public let pid: Int?
    public let muted: Bool
    /// The mode of the session's last turn; nil when its transcript has none.
    public let permissionMode: PermissionMode?
    /// Size of the conversation (tokens re-read when it continues); nil when unknown.
    public let contextTokens: Int?
    /// When the prompt cache of the last turn goes cold; nil when unknown.
    public let cacheExpiresAt: Date?
    public let startedAt: Date
    public let updatedAt: Date
}

extension SessionSummary {
    private enum CodingKeys: String, CodingKey {
        case id, title, cwd, status, waitingFor, owned, replyMode, canStop
        case summary, model, pid, muted, permissionMode, contextTokens, cacheExpiresAt, startedAt, updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        cwd = try c.decode(String.self, forKey: .cwd)
        status = try c.decode(SessionStatus.self, forKey: .status)
        waitingFor = try c.decode(WaitingReason?.self, forKey: .waitingFor)
        owned = try c.decode(Bool.self, forKey: .owned)
        replyMode = try c.decode(ReplyMode.self, forKey: .replyMode)
        canStop = try c.decode(Bool.self, forKey: .canStop)
        summary = try c.decode(String.self, forKey: .summary)
        model = try c.decode(String?.self, forKey: .model)
        pid = try c.decode(Int?.self, forKey: .pid)
        muted = try c.decode(Bool.self, forKey: .muted)
        permissionMode = try c.decodeIfPresent(PermissionMode.self, forKey: .permissionMode)
        contextTokens = try c.decodeIfPresent(Int.self, forKey: .contextTokens)
        cacheExpiresAt = try c.decodeIfPresent(Date.self, forKey: .cacheExpiresAt)
        startedAt = try c.decode(Date.self, forKey: .startedAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(cwd, forKey: .cwd)
        try c.encode(status, forKey: .status)
        try c.encode(waitingFor, forKey: .waitingFor)
        try c.encode(owned, forKey: .owned)
        try c.encode(replyMode, forKey: .replyMode)
        try c.encode(canStop, forKey: .canStop)
        try c.encode(summary, forKey: .summary)
        try c.encode(model, forKey: .model)
        try c.encode(pid, forKey: .pid)
        try c.encode(muted, forKey: .muted)
        try c.encode(permissionMode, forKey: .permissionMode)
        try c.encode(contextTokens, forKey: .contextTokens)
        try c.encode(cacheExpiresAt, forKey: .cacheExpiresAt)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}
