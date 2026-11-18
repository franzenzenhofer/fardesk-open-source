import Foundation

/// The user's own name, colour and pin for a session (docs/design/SESSION-LABELS.md). Stored on the daemon.
public struct SessionLabel: Codable, Sendable, Hashable {
    /// Custom name; nil shows the session's own title.
    public let name: String?
    public let color: LabelColor?
    public let pinned: Bool

    public static let none = SessionLabel(name: nil, color: nil, pinned: false)

    public init(name: String?, color: LabelColor?, pinned: Bool) {
        self.name = name
        self.color = color
        self.pinned = pinned
    }

    private enum CodingKeys: String, CodingKey { case name, color, pinned }

    /// Writes null for no name or no colour: the contract always carries all three keys.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(color, forKey: .color)
        try c.encode(pinned, forKey: .pinned)
    }
}

/// Label colours. Never red, grey, orange or green: those are the status colours (COLOUR-CODING.md).
public enum LabelColor: String, Codable, Sendable, Hashable, CaseIterable {
    case blue, teal, purple, pink

    public var displayName: String {
        rawValue.prefix(1).uppercased() + rawValue.dropFirst()
    }
}

/// `POST /v1/sessions/:id/label`: a patch, every key optional. `.some(nil)` clears a name or colour.
public struct LabelRequest: Codable, Sendable, Hashable {
    public let name: String??
    public let color: LabelColor??
    public let pinned: Bool?

    public static func rename(_ name: String?) -> LabelRequest { LabelRequest(name: .some(name), color: nil, pinned: nil) }
    public static func color(_ color: LabelColor?) -> LabelRequest { LabelRequest(name: nil, color: .some(color), pinned: nil) }
    public static func pin(_ pinned: Bool) -> LabelRequest { LabelRequest(name: nil, color: nil, pinned: pinned) }

    public init(name: String??, color: LabelColor??, pinned: Bool?) {
        self.name = name
        self.color = color
        self.pinned = pinned
    }

    private enum CodingKeys: String, CodingKey { case name, color, pinned }

    /// A missing key stays nil (not changed); a key with null becomes .some(nil) (cleared).
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.contains(.name) ? .some(try c.decode(String?.self, forKey: .name)) : nil
        color = c.contains(.color) ? .some(try c.decode(LabelColor?.self, forKey: .color)) : nil
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let name { try c.encode(name, forKey: .name) }
        if let color { try c.encode(color, forKey: .color) }
        try c.encodeIfPresent(pinned, forKey: .pinned)
    }
}

/// What a typed name becomes: trimmed and at most `maxLength` characters; empty, or the session's own title,
/// means no custom name (nil).
public enum SessionLabelName {
    public static let maxLength = 80

    public static func normalised(_ typed: String, title: String?) -> String? {
        let trimmed = String(typed.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLength))
        if trimmed.isEmpty || trimmed == title { return nil }
        return trimmed
    }
}

extension SessionSummary {
    /// The name the list and the chat header show: the user's own name, else the session title.
    public var displayTitle: String { label.name ?? title }
}
