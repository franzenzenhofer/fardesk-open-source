import Foundation

/// A hub: the address every call goes through.
public struct HubLink: Codable, Sendable, Hashable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    private enum CodingKeys: String, CodingKey {
        case url
    }

    /// A hub setting read from disk or from a launch setting holds a tailnet address and nothing else (`MachineAddress`).
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try MachineAddress.require(try c.decode(URL.self, forKey: .url), otherwise: .address)
    }
}
