/// The contract version literal (`contractVersion` / `v`). Decoding any other value fails.
public struct ContractVersion: Codable, Sendable, Hashable {
    public static let current = 1

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer().decode(Int.self)
        guard value == Self.current else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Unsupported contract version \(value)")
            )
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(Self.current)
    }
}
