import FardeskClient
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation

/// A REAL hub daemon with one live peer ("Peer A", seeded with the standard sessions) and one
/// peer on a closed port ("Dead Box"), all on 127.0.0.1. The peer's token is the shared test token.
public struct HubRig: Sendable {
    public static let peerName = "Peer A"
    public static let deadName = "Dead Box"
    public static let hubName = "hub-box"

    public let hub: TestDaemon
    public let peer: TestDaemon

    /// The hub's own API (the root, where the hub token logs in and `GET /v1/hub` answers).
    public var hubAPI: FardeskAPI { FardeskAPI(baseURL: hub.url, token: TestDaemon.token, timeout: 5) }

    public static func with<Result: Sendable>(
        isolation: isolated (any Actor)? = #isolation,
        _ body: (HubRig) async throws -> Result
    ) async throws -> Result {
        try await TestDaemon.with(configOverrides: ["name": peerName]) { peer in
            let deadPort = try freePort()
            let overrides: [String: any Sendable] = [
                "name": hubName,
                "hub": ["enabled": true, "probeMs": 200] as [String: any Sendable],
                "peers": [
                    ["name": peerName, "url": peer.url.absoluteString],
                    ["name": deadName, "url": "http://127.0.0.1:\(deadPort)"],
                ] as [[String: String]],
                "coordinator": ["enabled": true, "peerTokens": [peerName: TestDaemon.token, deadName: TestDaemon.token]] as [String: any Sendable],
            ]
            return try await TestDaemon.with(sessions: [], configOverrides: overrides) { hub in
                let rig = HubRig(hub: hub, peer: peer)
                try await rig.untilPeerIsLive()
                return try await body(rig)
            }
        }
    }

    /// Waits until the hub reports the peer online and relays its machine.
    public func untilPeerIsLive() async throws {
        let live = try await waitUntil(timeout: .seconds(20)) {
            let state = try? await hubAPI.hub()
            let online = state?.machines.first { $0.name == Self.peerName }?.online == true
            let dead = state?.machines.first { $0.name == Self.deadName }?.online == false
            return online && dead
        }
        guard live else { throw HubRigError.peerNeverLive }
    }

}

public enum HubRigError: Error {
    case peerNeverLive
}

extension StoreSandbox {
    /// An app model logged in to the rig's hub with the config token, started (the hub's machines are not in place yet).
    @MainActor
    public func startedHubModel(for rig: HubRig) async throws -> AppModel {
        try keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: rig.hub.url))
        let model = AppModel(configuration: configuration(hubURL: rig.hub.url))
        await model.start()
        return model
    }
}
