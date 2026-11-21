import Foundation

/// What a `fardesk://pair` link carries. Current links hold a one-time `code` (valid 2 minutes) that is
/// exchanged for a device token; links from older daemons hold the machine's permanent `token` instead.
public struct PairingPayload: Codable, Sendable, Hashable {
    public let v: ContractVersion
    public let name: String
    public let url: URL
    /// Old links only: the machine's permanent token, usable as is.
    public let token: String?
    /// One-time code to exchange at `POST /v1/auth/pair`.
    public let code: String?
    /// The machine is a hub (older links do not say: false).
    public let hub: Bool

    private enum CodingKeys: String, CodingKey {
        case v, name, url, token, code, hub
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = try c.decode(ContractVersion.self, forKey: .v)
        name = try c.decode(String.self, forKey: .name)
        url = try c.decode(URL.self, forKey: .url)
        token = try c.decodeIfPresent(String.self, forKey: .token)
        code = try c.decodeIfPresent(String.self, forKey: .code)
        hub = try c.decodeIfPresent(Bool.self, forKey: .hub) ?? false
        guard token != nil || code != nil else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "A pairing link needs a code or a token"))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(v, forKey: .v)
        try c.encode(name, forKey: .name)
        try c.encode(url, forKey: .url)
        try c.encodeIfPresent(token, forKey: .token)
        try c.encodeIfPresent(code, forKey: .code)
        try c.encode(hub, forKey: .hub)
    }
}
