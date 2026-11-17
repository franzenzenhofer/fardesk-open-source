import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Settings > Devices in hub mode, against a REAL hub daemon: the one hub token reads every machine's devices.
@MainActor
struct HubDevicesTests {
    @Test func devicesInHubModeUseTheHubTokenForEveryMachine() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await sandbox.startedHubModel(for: rig)
                let ready = try await waitUntil { await MainActor.run { model.machines.endpoints.count == 3 } }
                #expect(ready, "the hub's machines never arrived")
                let devices = await model.devices(timeout: 5)
                #expect(devices.count == 3)
                #expect(devices.allSatisfy { $0.problem?.contains("Not logged in") != true }, "\(devices.map(\.problem))")
                let peer = try #require(devices.first { $0.machineID == HubIdentity.machineID(name: HubRig.peerName) })
                #expect(peer.problem == nil)
                let hub = try #require(devices.first { $0.machineID == HubIdentity.machineID(name: HubRig.hubName) })
                #expect(hub.problem == nil)
                #expect(try sandbox.keychainTokens.load(HubIdentity.machineID(name: HubRig.peerName)) == nil, "only the hub holds a token")
                model.stop()
            }
        }
    }
}
