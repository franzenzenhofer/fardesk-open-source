/// The contract version (`contractVersion` / `v`): the major of the release line. Any number decodes; a machine
/// of another major is shown as such and only its lifeline (machine info and update) is used (docs/VERSIONING.md).
public struct ContractVersion: Codable, Sendable, Hashable {
    /// The major this build speaks.
    public static let current = 4

    public let value: Int

    public init(_ value: Int = ContractVersion.current) {
        self.value = value
    }

    public init(from decoder: any Decoder) throws {
        value = try decoder.singleValueContainer().decode(Int.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }

    /// True when the machine speaks the same major as this build.
    public var isCurrent: Bool { value == Self.current }
}

/// The plain line shown for a machine of another major.
public let differentVersionText = "This machine runs a different Fardesk version. Update the app or the machine."
