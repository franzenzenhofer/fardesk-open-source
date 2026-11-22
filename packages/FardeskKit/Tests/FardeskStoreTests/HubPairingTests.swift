import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Hub mode comes from pairing alone: a clean app (no build setting, no override) scans the hub's link, a REAL hub
/// answers, and the mode survives a restart.
@MainActor
struct HubPairingTests {
    /// The link `fardeskd pair` prints on the hub: a real one-time code, minted by the hub.
    private func hubLink(_ rig: HubRig) async throws -> String {
        try await PairingLinks.make(for: rig.hub, name: HubRig.hubName, hub: true)
    }

    /// A link whose code the hub never issued: the hub refuses it.
    private func refusedHubLink(_ rig: HubRig) throws -> String {
        try PairingLinks.make(url: rig.hub.url, name: HubRig.hubName, code: String(repeating: "cd", count: 32), hub: true)
    }

    private func isOnline(_ model: AppModel, _ name: String) async -> Bool {
        await MainActor.run { (try? model.state.machine(id: HubIdentity.machineID(name: name)))?.isOnline == true }
    }

    private func untilHubMachinesAreIn(_ model: AppModel) async throws {
        let ready = try await waitUntil {
            let listed = await MainActor.run { model.machines.endpoints.map(\.name).sorted() }
            let peer = await isOnline(model, HubRig.peerName)
            return listed == [HubRig.deadName, HubRig.hubName, HubRig.peerName].sorted() && peer
        }
        #expect(ready, "the hub's three machines never showed, the live peer online")
        let dead = try model.state.machine(id: HubIdentity.machineID(name: HubRig.deadName))
        #expect(!dead.isOnline, "the machine on a closed port stays offline")
    }

    @Test func aCleanAppPairsTheHubLinkAndTheHubModeSurvivesARestart() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = AppModel(configuration: sandbox.configuration())
                await model.start()
                #expect(model.needsOnboarding)
                #expect(!model.isHubMode)
                await model.pair(link: try await hubLink(rig))
                #expect(model.loginError == nil)
                #expect(model.isHubMode)
                #expect(model.phase == .ready)
                #expect(!model.needsOnboarding)
                try await untilHubMachinesAreIn(model)
                model.cacheWriter.flush()
                #expect(try sandbox.machinesFile.load().hub?.url == rig.hub.url, "the hub is saved on the device")
                #expect(try sandbox.keychainTokens.load(HubIdentity.tokenID(hub: rig.hub.url)) != nil, "the device token is stored")
                model.stop()

                let second = AppModel(configuration: sandbox.configuration())
                await second.start()
                #expect(second.isHubMode, "no build setting: the saved hub is what makes it hub mode")
                #expect(second.isLoggedIn)
                try await untilHubMachinesAreIn(second)
                second.stop()
            }
        }
    }

    @Test func aHubLinkTheHubRefusesLeavesAPairedAppAsItWas() async throws {
        try await TestDaemon.with { daemon in
            try await HubRig.with { rig in
                try await StoreSandbox.with { sandbox in
                    let model = AppModel(configuration: sandbox.configuration())
                    await model.start()
                    await model.pair(link: try await PairingLinks.make(for: daemon, name: "direct"))
                    #expect(model.phase == .ready)
                    let endpointsBefore = model.machines.endpoints

                    await model.pair(link: try refusedHubLink(rig))
                    #expect(model.phase == .ready, "a refused hub link must not log the app out")
                    #expect(model.machines.endpoints == endpointsBefore)
                    #expect(!model.isHubMode)
                    #expect(try sandbox.machinesFile.load().hub == nil)
                    #expect(model.loginError?.contains("Pairing failed") == true)
                    model.stop()
                }
            }
        }
    }

    @Test func logoutForgetsTheHubSoAnotherHubLinkPairs() async throws {
        try await HubRig.with { first in
            try await HubRig.with { second in
                try await StoreSandbox.with { sandbox in
                    let model = AppModel(configuration: sandbox.configuration())
                    await model.start()
                    await model.pair(link: try await hubLink(first))
                    #expect(model.isHubMode)

                    await model.logout(apnsToken: nil)
                    #expect(!model.isHubMode)
                    #expect(model.needsOnboarding)
                    #expect(try sandbox.machinesFile.load().hub == nil)
                    #expect(try sandbox.machinesFile.load().endpoints.isEmpty)

                    await model.pair(link: try await hubLink(second))
                    #expect(model.loginError == nil)
                    #expect(model.isHubMode)
                    let saved = try await waitUntil { (try? sandbox.machinesFile.load().hub?.url) == second.hub.url }
                    #expect(saved, "the new hub is saved on the device")
                    model.stop()
                }
            }
        }
    }

    @Test func aHubLinkTheHubRefusesLeavesTheAppOnTheOnboarding() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = AppModel(configuration: sandbox.configuration())
                await model.start()
                await model.pair(link: try refusedHubLink(rig))
                #expect(model.loginError?.contains("Pairing failed") == true)
                #expect(!model.isHubMode)
                #expect(model.needsOnboarding)
                #expect(try sandbox.machinesFile.load().hub == nil)
                model.stop()
            }
        }
    }
}
