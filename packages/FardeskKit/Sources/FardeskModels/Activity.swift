public enum Activity: Codable, Sendable, Hashable, Identifiable {
    case user(UserActivity)
    case assistant(AssistantActivity)
    case tool(ToolActivity)
    case files(FilesActivity)
    case question(QuestionActivity)
    case permission(PermissionActivity)
    case system(SystemActivity)

    private enum Kind: String, Codable {
        case user, assistant, tool, files, question, permission, system
    }

    private enum CodingKeys: String, CodingKey {
        case kind
    }

    public var id: String {
        switch self {
        case .user(let a): a.id
        case .assistant(let a): a.id
        case .tool(let a): a.id
        case .files(let a): a.id
        case .question(let a): a.id
        case .permission(let a): a.id
        case .system(let a): a.id
        }
    }

    public init(from decoder: any Decoder) throws {
        let kind = try decoder.container(keyedBy: CodingKeys.self).decode(Kind.self, forKey: .kind)
        switch kind {
        case .user: self = .user(try UserActivity(from: decoder))
        case .assistant: self = .assistant(try AssistantActivity(from: decoder))
        case .tool: self = .tool(try ToolActivity(from: decoder))
        case .files: self = .files(try FilesActivity(from: decoder))
        case .question: self = .question(try QuestionActivity(from: decoder))
        case .permission: self = .permission(try PermissionActivity(from: decoder))
        case .system: self = .system(try SystemActivity(from: decoder))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .user(let a): try a.encode(to: encoder); try container.encode(Kind.user, forKey: .kind)
        case .assistant(let a): try a.encode(to: encoder); try container.encode(Kind.assistant, forKey: .kind)
        case .tool(let a): try a.encode(to: encoder); try container.encode(Kind.tool, forKey: .kind)
        case .files(let a): try a.encode(to: encoder); try container.encode(Kind.files, forKey: .kind)
        case .question(let a): try a.encode(to: encoder); try container.encode(Kind.question, forKey: .kind)
        case .permission(let a): try a.encode(to: encoder); try container.encode(Kind.permission, forKey: .kind)
        case .system(let a): try a.encode(to: encoder); try container.encode(Kind.system, forKey: .kind)
        }
    }
}
