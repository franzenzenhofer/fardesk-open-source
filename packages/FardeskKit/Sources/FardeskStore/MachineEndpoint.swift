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
}
