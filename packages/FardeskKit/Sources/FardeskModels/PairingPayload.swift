import Foundation

/// What a `fardesk://pair` link carries: a one-time `code` (valid 2 minutes, one device) that is exchanged for a device
/// token of this device's own. Every field is required; a link without code or hub does not decode.
public struct PairingPayload: Codable, Sendable, Hashable {
    public let v: ContractVersion
    public let name: String
    public let url: URL
    /// One-time code to exchange at `POST /v1/auth/pair`.
    public let code: String
    /// Whether the machine is a hub.
    public let hub: Bool

    private enum CodingKeys: String, CodingKey {
        case v, name, url, code, hub
    }

    /// The shortest code the daemon issues (and accepts): 32 characters.
    public static let minimumCodeLength = 32

    private struct AnyKey: CodingKey {
        let stringValue: String
        let intValue: Int? = nil
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    /// Strict like the daemon's schema: http address on a tailnet address (`MachineAddress`), a code of at least 32 characters, no unknown keys.
    public init(from decoder: any Decoder) throws {
        let known = Set(["v", "name", "url", "code", "hub"])
        let anyKeys = try decoder.container(keyedBy: AnyKey.self)
        if let unknown = anyKeys.allKeys.map(\.stringValue).filter({ !known.contains($0) }).sorted().first {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Unknown key in the pairing link: \(unknown)")
            )
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = try c.decode(ContractVersion.self, forKey: .v)
        name = try c.decode(String.self, forKey: .name)
        url = try c.decode(URL.self, forKey: .url)
        guard url.scheme?.lowercased() == "http", url.host?.isEmpty == false else {
            throw DecodingError.dataCorruptedError(forKey: .url, in: c, debugDescription: "The pairing address must be http on a tailnet address")
        }
        _ = try MachineAddress.require(url, otherwise: .link)
        code = try c.decode(String.self, forKey: .code)
        guard code.count >= Self.minimumCodeLength else {
            throw DecodingError.dataCorruptedError(
                forKey: .code, in: c, debugDescription: "The pairing code is shorter than \(Self.minimumCodeLength) characters"
            )
        }
        hub = try c.decode(Bool.self, forKey: .hub)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(v, forKey: .v)
        try c.encode(name, forKey: .name)
        try c.encode(url, forKey: .url)
        try c.encode(code, forKey: .code)
        try c.encode(hub, forKey: .hub)
    }
}
