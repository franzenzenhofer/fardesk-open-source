/// A string enum the daemon sends. A value this build does not know decodes to `unknown` instead of failing the
/// whole answer, so a newer daemon never breaks an older app (docs/VERSIONING.md, section 3).
public protocol TolerantEnum: RawRepresentable, Codable, Sendable, Hashable where RawValue == String {
    static var unknown: Self { get }
}

extension TolerantEnum {
    public init(from decoder: any Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: text) ?? .unknown
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public var isUnknown: Bool { self == Self.unknown }
}

/// The plain line the UI shows for a value an older app cannot name.
public let unknownStateText = "Unknown state, update the app"
