import Foundation

// Payload structs for each `kind` of Activity. The `kind` discriminator itself is
// written and read by `Activity`, never stored here.

public struct UserActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let text: String
}

public struct AssistantActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let text: String
}

public struct SystemActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let text: String
}

extension SystemActivity {
    private enum KnownKeys: String, CodingKey {
        case id, ts
    }

    /// An activity of a kind a newer daemon added: shown as a neutral system line.
    init(unknownKindFrom decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: KnownKeys.self)
        id = try c.decode(String.self, forKey: .id)
        ts = try c.decode(Date.self, forKey: .ts)
        text = unknownStateText
    }
}

public struct ToolActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let tool: String
    public let title: String
    public let status: ToolStatus
    public let hasDetail: Bool
    public let durationMs: Int?
}

extension ToolActivity {
    private enum CodingKeys: String, CodingKey {
        case id, ts, tool, title, status, hasDetail, durationMs
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        ts = try c.decode(Date.self, forKey: .ts)
        tool = try c.decode(String.self, forKey: .tool)
        title = try c.decode(String.self, forKey: .title)
        status = try c.decode(ToolStatus.self, forKey: .status)
        hasDetail = try c.decode(Bool.self, forKey: .hasDetail)
        durationMs = try c.decode(Int?.self, forKey: .durationMs)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(ts, forKey: .ts)
        try c.encode(tool, forKey: .tool)
        try c.encode(title, forKey: .title)
        try c.encode(status, forKey: .status)
        try c.encode(hasDetail, forKey: .hasDetail)
        try c.encode(durationMs, forKey: .durationMs)
    }
}

public struct FilesActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let title: String
    public let changed: [String]
}

public struct QuestionActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let requestId: String
    public let text: String
    public let options: [String]
    public let state: QuestionState
    /// With state `.terminal`: tapping an option types its number into the dialog at the computer. Absent otherwise.
    public let typable: Bool?
}

public struct PermissionActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let requestId: String
    public let tool: String
    public let title: String
    public let summary: String
    public let cwd: String
    public let destructive: Bool
    public let state: PermissionState
    /// With state `.terminal`: Allow or Deny types the matching key into the dialog at the computer. Absent otherwise.
    public let typable: Bool?
    /// ExitPlanMode only: the whole plan as markdown. Absent for every other tool.
    public let plan: String?
    /// ExitPlanMode only: the choices the machine offers, a subset of "approve_bypass", "approve_manual", "revise".
    /// Absent from a daemon without the "plan-approval" feature.
    public let planChoices: [String]?
}
