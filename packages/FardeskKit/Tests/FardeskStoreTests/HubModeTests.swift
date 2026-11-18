import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Hub mode of the app model against a REAL hub daemon with a live and a dead peer.
@MainActor
struct HubModeTests {
    private func configuration(_ sandbox: StoreSandbox, hub: URL, tokens: TokenStore? = nil) -> AppModelConfiguration {
        sandbox.configuration(tokens: tokens, hubURL: hub)
    }

    /// A model logged in to the hub with the config token, started, with the hub's machines in place.
    private func hubModel(_ rig: HubRig, _ sandbox: StoreSandbox) async throws -> AppModel {
        try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: rig.hub.url))
        let model = AppModel(configuration: configuration(sandbox, hub: rig.hub.url))
        await model.start()
        let ready = try await waitUntil {
            await MainActor.run { model.machines.endpoints.count == 3 && (try? model.state.machine(id: HubIdentity.machineID(name: HubRig.peerName)))?.isOnline == true }
        }
        #expect(ready, "the hub's machines never came online")
        return model
    }

    /// The hub token is the config token and the live peer comes online through the hub; stops the model.
    private func expectHubTokenBringsPeerOnline(_ model: AppModel, _ rig: HubRig, _ sandbox: StoreSandbox) async throws {
        #expect(try sandbox.keychainTokens.load(HubIdentity.tokenID(hub: rig.hub.url)) == TestDaemon.token)
        let online = try await waitUntil {
            await MainActor.run { (try? model.state.machine(id: HubIdentity.machineID(name: HubRig.peerName)))?.isOnline == true }
        }
        #expect(online, "the peer comes online through the hub with that one token")
        model.stop()
    }

    private var peerID: UUID { HubIdentity.machineID(name: HubRig.peerName) }
    private var deadID: UUID { HubIdentity.machineID(name: HubRig.deadName) }

    /// Starts a model in hub mode and pairs it with a real link for the rig's hub.
    private func pairedModel(_ rig: HubRig, _ sandbox: StoreSandbox, tokens: TokenStore? = nil) async throws -> AppModel {
        let model = AppModel(configuration: configuration(sandbox, hub: rig.hub.url, tokens: tokens))
        await model.start()
        let json = #"{"v":1,"name":"\#(HubRig.hubName)","url":"\#(rig.hub.url.absoluteString)","token":"\#(TestDaemon.token)"}"#
        let payload = try FardeskJSON.makeDecoder().decode(PairingPayload.self, from: Data(json.utf8))
        await model.pair(link: try PairingLink.make(payload))
        return model
    }

    @Test func aPairingLinkForTheHubIsTheOneTokenForEveryMachine() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await pairedModel(rig, sandbox)
                #expect(model.loginError == nil)
                try await expectHubTokenBringsPeerOnline(model, rig, sandbox)
            }
        }
    }

    @Test func aLoginThatCannotBeStoredSaysSoInsteadOfBlamingTheHub() async throws {
        struct StoreRefused: Error {}
        let refusing = TokenStore(
            load: { _ in nil },
            save: { _, _ in throw StoreRefused() },
            delete: { _ in },
            storedMachineIDs: { [] },
            deleteAll: {}
        )
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await pairedModel(rig, sandbox, tokens: refusing)
                #expect(model.loginError?.contains("the hub accepted the link, but this device could not store the login") == true)
                #expect(model.loginError?.contains("did not accept") == false)
                model.stop()
            }
        }
    }

    @Test func aDirectLoginToTheHubsMachineFromAnOlderBuildBecomesTheHubToken() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let direct = MachineEndpoint(name: HubRig.hubName, url: rig.hub.url)
                try sandbox.machinesFile.save(MachineList(endpoints: [direct]))
                try sandbox.keychainTokens.save(TestDaemon.token, direct.id)
                let model = AppModel(configuration: configuration(sandbox, hub: rig.hub.url))
                await model.start()
                #expect(model.isLoggedIn, "no new login after the update")
                try await expectHubTokenBringsPeerOnline(model, rig, sandbox)
            }
        }
    }

    @Test func machineListIsTheHubsListWithStableIDsAndOneToken() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                #expect(model.isHubMode)
                #expect(model.machines.endpoints.map(\.name) == [HubRig.hubName, HubRig.peerName, HubRig.deadName])
                #expect(model.machines.endpoints.map(\.id) == [HubRig.hubName, HubRig.peerName, HubRig.deadName].map { HubIdentity.machineID(name: $0) })
                #expect(model.machines.endpoints[1].url.absoluteString == "\(rig.hub.url.absoluteString)/m/Peer%20A")
                let machine = try model.state.machine(id: peerID)
                #expect(machine.machine?.name == HubRig.peerName, "the stream through the hub delivered the peer's hello")
                #expect(machine.sessions.count == SeedSession.standard.count)
                #expect(try sandbox.keychainTokens.load(peerID) == nil, "only the hub holds a token")
                #expect(try sandbox.machinesFile.load().hub == rig.hub.url)
                model.stop()
            }
        }
    }

    @Test func aDeadMachineIsOfflineWithTheHubsProblemAndNoAlert() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let dead = try model.state.machine(id: deadID)
                #expect(dead.connection != .online)
                #expect(MachinePresentation(machine: dead, now: Date()).statusLabel == "Offline")
                #expect(MachinePresentation(machine: dead, now: Date()).problem?.isEmpty == false)
                await model.openSession(SessionRef(machineID: deadID, sessionID: "x"))
                _ = await model.send("hello", to: SessionRef(machineID: deadID, sessionID: "x"))
                #expect(model.lastError == nil, "machine_offline is quiet")
                model.stop()
            }
        }
    }

    @Test func openingASessionCachesItsFeedAndTheNextOpenShowsItAtOnce() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let ref = SessionRef(machineID: peerID, sessionID: SeedSession.editsSessionID)
                await model.openSession(ref)
                let shown = model.feeds.feed(for: SessionRef(machineID: peerID, sessionID: ref.sessionID))
                #expect(!shown.activities.isEmpty)
                model.flushFeeds()
                model.cacheWriter.flush()
                let cached = try #require(sandbox.cache.loadFeed(machineID: peerID, sessionID: ref.sessionID))
                #expect(cached.activities.map(\.id) == shown.snapshot().activities.map(\.id))
                model.stop()

                let second = AppModel(configuration: configuration(sandbox, hub: rig.hub.url))
                await second.start()
                await second.restoreCachedFeed(ref)
                let instant = second.feeds.feed(for: SessionRef(machineID: peerID, sessionID: ref.sessionID))
                #expect(instant.activities.map(\.id) == cached.activities.map(\.id), "shown before any call answered")
                second.stop()
            }
        }
    }

    /// stop() (the app goes to the background) must leave the open session's feed on disk when it returns: it used to
    /// flush the cache writer first and only then queue the feeds, so their write came a second later or never.
    @Test func stopLeavesTheOpenFeedOnDiskWhenItReturns() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let ref = SessionRef(machineID: peerID, sessionID: SeedSession.editsSessionID)
                await model.openSession(ref)
                #expect(!model.feeds.feed(for: ref).activities.isEmpty)
                model.stop()
                let cached = sandbox.cache.loadFeed(machineID: peerID, sessionID: ref.sessionID)
                #expect(cached?.activities.isEmpty == false)
            }
        }
    }

    @Test func aCachedSessionOpensEvenWhenTheHubIsGone() async throws {
        let ref = SessionRef(machineID: HubIdentity.machineID(name: HubRig.peerName), sessionID: SeedSession.editsSessionID)
        try await StoreSandbox.with { sandbox in
            try await HubRig.with { rig in
                let model = try await hubModel(rig, sandbox)
                await model.openSession(ref)
                model.stop()
            }
            let gone = URL(string: "http://127.0.0.1:\(try freePort())")!
            try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: gone))
            var list = try sandbox.machinesFile.load()
            list.setHub(gone)
            list.replaceEndpoints([HubIdentity.endpoint(machine: HubRig.peerName, hub: gone)])
            try sandbox.machinesFile.save(list)
            let offline = AppModel(configuration: configuration(sandbox, hub: gone))
            await offline.start()
            let machineID = ref.machineID
            await offline.openSession(SessionRef(machineID: machineID, sessionID: ref.sessionID))
            #expect(!(offline.feeds.feed(for: SessionRef(machineID: machineID, sessionID: ref.sessionID)).activities.isEmpty))
            #expect(offline.lastError == nil)
            offline.stop()
        }
    }

    @Test func aHubThatDoesNotAnswerShowsEveryMachineOffline() async throws {
        try await StoreSandbox.with { sandbox in
            let gone = URL(string: "http://127.0.0.1:\(try freePort())")!
            try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: gone))
            var list = MachineList()
            list.setHub(gone)
            list.replaceEndpoints([HubIdentity.endpoint(machine: "Linux", hub: gone)])
            try sandbox.machinesFile.save(list)
            let model = AppModel(configuration: sandbox.configuration(hubURL: gone, tailscaleIsOn: { false }))
            await model.start()
            let offline = try await waitUntil {
                await MainActor.run { model.state.machines.allSatisfy { if case .offline = $0.connection { true } else { false } } }
            }
            #expect(offline)
            #expect(model.connectivityBanner == .notOnTailscale)
            model.stop()
        }
    }

    @Test func pausingReachesEveryOnlineMachineThroughTheHub() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                #expect(await model.pauseNotifications(minutes: 60))
                let until = try #require(model.state.pausedUntil(now: Date()))
                #expect(until.timeIntervalSinceNow > 59 * 60)
                #expect(PausePresentation.label(pausedUntil: until, now: Date())?.hasPrefix("Paused until ") == true)
                #expect(await model.pauseNotifications(minutes: 0))
                #expect(model.state.pausedUntil(now: Date()) == nil)
                model.stop()
            }
        }
    }

    @Test(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
    func oneLoginToTheHubCoversEveryMachine() async throws {
        try await HubRig.with { rig in
            try await rig.hub.setPassword("hub-password")
            try await StoreSandbox.with { sandbox in
                let hub = rig.hub.url
                var list = MachineList()
                list.setHub(hub)
                try sandbox.machinesFile.save(list)
                let model = AppModel(configuration: configuration(sandbox, hub: hub))
                await model.start()
                #expect(model.phase == .loggedOut)
                await model.login(password: "hub-password")
                #expect(model.phase == .ready)
                #expect(try sandbox.keychainTokens.load(HubIdentity.tokenID(hub: hub)) != nil)
                let came = try await waitUntil { await MainActor.run { model.machines.endpoints.count == 3 } }
                #expect(came)
                #expect(try model.machines.endpoints.allSatisfy { try sandbox.keychainTokens.load($0.id) == nil })
                model.stop()
            }
        }
    }
}
