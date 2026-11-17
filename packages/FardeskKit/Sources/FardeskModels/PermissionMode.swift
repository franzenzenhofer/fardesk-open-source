/// Claude Code permission modes. A mode this build does not know decodes as `.other`, so a newer
/// daemon never breaks an older client.
public enum PermissionMode: Codable, Sendable, Hashable {
    case `default`
    case acceptEdits
    case plan
    case bypassPermissions
    case dontAsk
    case auto
    case other(String)

    /// The modes the New Session picker offers, in menu order (default first).
    public static let pickable: [PermissionMode] = [.bypassPermissions, .auto, .acceptEdits, .default, .plan]

    public var rawValue: String {
        switch self {
        case .default: "default"
        case .acceptEdits: "acceptEdits"
        case .plan: "plan"
        case .bypassPermissions: "bypassPermissions"
        case .dontAsk: "dontAsk"
        case .auto: "auto"
        case .other(let value): value
        }
    }

    public init(rawValue: String) {
        let known = [Self.default, .acceptEdits, .plan, .bypassPermissions, .dontAsk, .auto]
        self = known.first { $0.rawValue == rawValue } ?? .other(rawValue)
    }

    public init(from decoder: any Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    /// The name shown to people.
    public var label: String {
        switch self {
        case .default: "Ask"
        case .acceptEdits: "Accept edits"
        case .plan: "Plan"
        case .bypassPermissions: "Bypass permissions"
        case .dontAsk: "Do not ask"
        case .auto: "Auto"
        case .other(let value): value
        }
    }
}
