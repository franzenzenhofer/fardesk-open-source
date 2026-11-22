import FardeskModels
import Foundation

/// One paired machine as the client stores it: where to reach it. The bearer token is NOT here;
/// it lives in the `TokenStore`, keyed by `id`.
public struct MachineEndpoint: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let url: URL

    public init(id: UUID = UUID(), name: String, url: URL) {
        self.id = id
        self.name = name
        self.url = url
    }

    public init(payload: PairingPayload, id: UUID = UUID()) {
        self.init(id: id, name: payload.name, url: payload.url)
    }

    private enum CodingKeys: String, CodingKey { case id, name, url }

    /// A saved machine obeys the same tailnet rule as a pairing link: a list entry written by an older build, by
    /// hand or by another process can never point the app outside the tailnet.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        url = try MachineAddress.require(c.decode(URL.self, forKey: .url), otherwise: .address)
    }
}
