/// `Machine.update`: the state of the last self-update of a daemon (docs/VERSIONING.md, section 5).
public struct MachineUpdate: Codable, Sendable, Hashable {
    public enum State: String, TolerantEnum {
        case idle, running, failed, done, unknown
    }

    public let state: State
    public let message: String?
    public let version: String?
    public let packageSha256: String?
    public let at: String?

    private enum CodingKeys: String, CodingKey {
        case state, message, version, packageSha256, at
    }

    public init(state: State, message: String? = nil, version: String? = nil, packageSha256: String? = nil, at: String? = nil) {
        self.state = state
        self.message = message
        self.version = version
        self.packageSha256 = packageSha256
        self.at = at
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = try c.decode(State.self, forKey: .state)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        version = try c.decodeIfPresent(String.self, forKey: .version)
        packageSha256 = try c.decodeIfPresent(String.self, forKey: .packageSha256)
        at = try c.decodeIfPresent(String.self, forKey: .at)
    }

    /// Like the daemon: a missing detail is written as `null`.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(state, forKey: .state)
        try c.encode(message, forKey: .message)
        try c.encode(version, forKey: .version)
        try c.encode(packageSha256, forKey: .packageSha256)
        try c.encode(at, forKey: .at)
    }
}

/// `{ ok: true, state: "running" }`: the machine took the package and installs it in the background.
public struct MachineUpdateResult: Codable, Sendable, Hashable {
    public let ok: Bool
    public let state: MachineUpdate.State
}

/// What a daemon can do, by the names in `Machine.features`. New names are added; the app decides by feature.
public enum MachineFeature: String, Sendable, Hashable, CaseIterable {
    case chatImage = "chat-image"
    case selfUpdate = "self-update"
    case coldLastTurn = "cold-last-turn"
    case claudeDialogs = "claude-dialogs"
    case planApproval = "plan-approval"
}

extension Machine {
    public func supports(_ feature: MachineFeature) -> Bool {
        features.contains(feature.rawValue)
    }

    /// False for a machine of another major: only the lifeline (machine info, update) is used for it.
    public var isCompatible: Bool { contractVersion.isCurrent }
}

/// One machine in the answer of `POST /v1/hub/update-all`.
public struct HubUpdateMachine: Codable, Sendable, Hashable {
    public enum Result: String, TolerantEnum {
        case started, current, failed, unknown
    }

    public let name: String
    public let from: String?
    public let result: Result
    public let message: String?

    private enum CodingKeys: String, CodingKey {
        case name, from, result, message
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        from = try c.decodeIfPresent(String.self, forKey: .from)
        result = try c.decode(Result.self, forKey: .result)
        message = try c.decodeIfPresent(String.self, forKey: .message)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(from, forKey: .from)
        try c.encode(result, forKey: .result)
        try c.encode(message, forKey: .message)
    }
}

/// The answer of `POST /v1/hub/update-all`: which machine the package came from and what each machine did.
public struct HubUpdateResult: Codable, Sendable, Hashable {
    public let source: String
    public let version: String
    public let machines: [HubUpdateMachine]
}
