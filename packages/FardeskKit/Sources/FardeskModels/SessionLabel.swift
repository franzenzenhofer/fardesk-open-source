import Foundation

/// The user's own name, colour and pin for a session (docs/design/SESSION-LABELS.md). Stored on the daemon.
public struct SessionLabel: Codable, Sendable, Hashable {
    /// Custom name; nil shows the session's own title.
    public let name: String?
    public let color: LabelColor?
    public let pinned: Bool
    /// 16-hex content hash of the chat's own image; nil when it has none. Changes whenever the image changes.
    public let image: String?

    public static let none = SessionLabel(name: nil, color: nil, pinned: false)

    public init(name: String?, color: LabelColor?, pinned: Bool, image: String? = nil) {
        self.name = name
        self.color = color
        self.pinned = pinned
        self.image = image
    }

    private enum CodingKeys: String, CodingKey { case name, color, pinned, image }

    /// The image key is optional on the wire (null or missing means no image) so an older machine still decodes.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String?.self, forKey: .name)
        color = try c.decode(LabelColor?.self, forKey: .color)
        pinned = try c.decode(Bool.self, forKey: .pinned)
        image = try c.decodeIfPresent(String.self, forKey: .image)
    }

    /// Writes null for no name or no colour: the contract always carries all three keys.
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(color, forKey: .color)
        try c.encode(pinned, forKey: .pinned)
        try c.encode(image, forKey: .image)
    }
}

/// `POST /v1/sessions/:id/image`: the content hash of the stored image.
public struct ImageResult: Codable, Sendable, Hashable {
    public let ok: Bool
    public let image: String
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

    /// The colour the list shows next to the session: the user's own pick always wins; the daemon's automatic
    /// colour only while automatic colour coding is on (`ColourCoding`).
    public func shownColor(automatic: Bool) -> LabelColor? {
        label.color ?? (automatic ? autoColor : nil)
    }
}
