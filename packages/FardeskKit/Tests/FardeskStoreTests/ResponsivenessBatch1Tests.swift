import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Observation
import Testing

/// Launch phases, streams that follow reality, the token cache, the off-main extension writer, hang records
/// and the Coordinator on the hub machine (docs/FIX-LIST-2026-11-16.md, batch 1).
@MainActor
struct ResponsivenessBatch1Tests {
    private func hubModel(
        _ rig: HubRig, _ sandbox: StoreSandbox, token: String = TestDaemon.token, hubURL: URL? = nil,
        transport: URL? = nil
    ) throws -> AppModel {
        let hub = hubURL ?? rig.hub.url
        try sandbox.keychainTokens.save(token, HubIdentity.tokenID(hub: hub))
        var configuration = sandbox.configuration(hubURL: hub)
        if let transport {
            configuration = AppModelConfiguration(
                machinesFile: sandbox.machinesFile, tokens: sandbox.keychainTokens, cache: sandbox.cache,
                deviceName: "Test Device", requestTimeout: 5, backoff: BackoffPolicy(initial: 0.05, maximum: 0.2, jitter: 0),
                telemetryFile: sandbox.telemetryFile, hub: hub, hubPollInterval: 0.2, hubTransport: transport
            )
        }
        return AppModel(configuration: configuration)
    }

    /// How often the app told the hub it connected a stream to the peer.
    private static func connections(_ rig: HubRig) async -> Int {
        let events = (try? await rig.hubAPI.telemetry(kind: .event).reports) ?? []
        return events.filter { $0.area == "stream" && $0.message == "connected" && $0.machine == HubRig.peerName }.count
    }

    private var peerID: UUID { HubIdentity.machineID(name: HubRig.peerName) }

    // MARK: Phases

    @Test func theAppStartsLaunchingNeverLoggedOutAndGoesStraightToReadyWithAToken() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try hubModel(rig, sandbox)
                #expect(model.phase == .launching)
                await model.start()
                #expect(model.phase == .ready)
                model.stop()
            }
        }
    }

    @Test func aStoredTokenIsEnoughEvenWhenTheHubIsDown() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let down = URL(string: "http://127.0.0.1:9")!
                let model = try hubModel(rig, sandbox, transport: down)
                await model.start()
                #expect(model.phase == .ready, "the hub being down is not a reason to ask for the password")
                let said = try await waitUntil { await MainActor.run { model.hubStatus?.isUnreachable == true } }
                #expect(said)
                #expect(model.phase == .ready)
                model.stop()
            }
        }
    }

    @Test func withoutATokenTheLoginScreenComesAndAnUnauthorizedHubSendsYouThere() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                var list = MachineList()
                list.setHub(rig.hub.url)
                try sandbox.machinesFile.save(list)
                let none = AppModel(configuration: sandbox.configuration(hubURL: rig.hub.url))
                await none.start()
                #expect(none.phase == .loggedOut)

                let wrong = try hubModel(rig, sandbox, token: String(repeating: "cd", count: 32))
                await wrong.start()
                #expect(wrong.phase == .ready)
                let out = try await waitUntil { await MainActor.run { wrong.phase == .loggedOut } }
                #expect(out, "the hub refused the token: the login screen asks again")
                #expect(wrong.loginError?.contains("Log in again") == true)
            }
        }
    }

    // MARK: Streams follow reality

    @Test func streamsComeBackAfterStopAndStart() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try hubModel(rig, sandbox)
                await model.start()
                let first = try await waitUntil { await Self.connections(rig) >= 1 }
                #expect(first)
                model.stop()
                await model.start()
                let again = try await waitUntil(timeout: .seconds(3)) { await Self.connections(rig) >= 2 }
                #expect(again, "a stream is open again within 3 s of coming back")
                model.stop()
            }
        }
    }

    @Test func aMachineOfflineAnswerThenAPollOpensNoSecondStream() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try hubModel(rig, sandbox)
                await model.start()
                let up = try await waitUntil { await MainActor.run { model.streams[peerID] != nil } }
                #expect(up)
                let before = try #require(model.streams[peerID])
                model.markMachineOffline(peerID, problem: "pretend it dropped")
                await model.pollHub()
                #expect(model.streams[peerID] == before, "the stream that is open is the stream that stays")
                #expect(model.streams.count == 2, "hub and the live peer, not the dead one")
                model.stop()
            }
        }
    }

    // MARK: Tokens

    @Test func aTokenIsReadOnceUntilLoginLogoutOrWipeSaysOtherwise() throws {
        let sandbox = try StoreSandbox()
        let endpoint = Fixtures.endpoint("Linux")
        let access = MachineAccess(tokens: sandbox.fileTokens)
        try sandbox.fileTokens.save("first-token", endpoint.id)
        #expect(try access.api(for: endpoint).token == "first-token")
        try sandbox.fileTokens.save("second-token", endpoint.id)
        #expect(try access.api(for: endpoint).token == "first-token", "served from memory, no second read")
        access.tokenCache.invalidate()
        #expect(try access.api(for: endpoint).token == "second-token")
        try sandbox.fileTokens.deleteAll()
        access.tokenCache.invalidate()
        #expect(throws: MachineAccessError.self) { _ = try access.api(for: endpoint) }
    }

    @Test func theTransportMovesRequestsButNotTheIdentity() throws {
        let sandbox = try StoreSandbox()
        let hub = URL(string: "http://100.64.0.10:4780")!
        let access = MachineAccess(tokens: sandbox.fileTokens, hub: hub, transport: URL(string: "http://127.0.0.1:9")!)
        let endpoint = HubIdentity.endpoint(machine: "Mac mini Pro", hub: hub)
        try sandbox.fileTokens.save("hub-token", HubIdentity.tokenID(hub: hub))
        let api = try access.api(for: endpoint)
        #expect(api.baseURL.absoluteString == "http://127.0.0.1:9/m/Mac%20mini%20Pro")
        #expect(api.token == "hub-token")
    }

    // MARK: needsYou and the extension writer

    @Test func needsYouIsAssignedOnlyWhenItChanges() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, endpoint) = try await sandbox.startedModelWithSessions()
            let waiting = model.needsYou.count
            #expect(waiting > 0)
            let callbacks = LockedCounter()
            withObservationTracking { _ = model.needsYou } onChange: { callbacks.increment() }
            model.apply(.ping(ts: Date()), from: endpoint.id)
            model.apply(try Fixtures.event("helloWithSessions"), from: endpoint.id)
            model.stateChanged()
            #expect(callbacks.value == 0 && model.needsYou.count == waiting, "an unchanged state does not touch needsYou")
        }
    }

    @Test func theExtensionWriterWritesTheNewestStateOnceAndOnlyWhenTheWidgetWouldChange() async throws {
        let sandbox = try StoreSandbox()
        let store = WaitingSnapshotStore(directory: sandbox.root)
        let reloads = LockedCounter()
        let writer = ExtensionWriter(store: store, delay: .milliseconds(100), onWritten: { reloads.increment() })
        var state = AppState(endpoints: [Fixtures.endpoint("Studio")])
        guard case .hello = try Fixtures.event("helloWithSessions") else { return }
        try state.apply(try Fixtures.event("helloWithSessions"), from: state.machines[0].id)
        for _ in 0..<30 { await writer.submit(state) }
        try await Task.sleep(for: .milliseconds(500))
        #expect(await writer.writes == 1 && reloads.value == 1, "thirty states, one write")
        #expect(store.read()?.count == state.needsYouCount)
        await writer.submit(state)
        try await Task.sleep(for: .milliseconds(400))
        #expect(await writer.writes == 1, "the same content again writes nothing")
    }

    // MARK: Hangs

    @Test func hangsAreWrittenAtOneTwoTenAndThirtySecondsEachOnce() {
        #expect(HangThresholds.newlyCrossed(elapsed: 0.9, alreadyWritten: 0) == nil)
        #expect(HangThresholds.newlyCrossed(elapsed: 1.2, alreadyWritten: 0) == 1)
        #expect(HangThresholds.newlyCrossed(elapsed: 1.7, alreadyWritten: 1) == nil)
        #expect(HangThresholds.newlyCrossed(elapsed: 2.0, alreadyWritten: 1) == 2)
        #expect(HangThresholds.newlyCrossed(elapsed: 11, alreadyWritten: 2) == 10)
        #expect(HangThresholds.newlyCrossed(elapsed: 31, alreadyWritten: 10) == 30)
        #expect(HangThresholds.newlyCrossed(elapsed: 90, alreadyWritten: 30) == nil)
    }

    @Test func theHangLogKeepsRecordsUntilTheNextLaunchTakesThem() throws {
        let sandbox = try StoreSandbox()
        let log = HangLog(url: sandbox.root.appending(path: "Fardesk/hangs.jsonl"))
        #expect(log.takeAll().isEmpty)
        Breadcrumbs.mark("apply hub")
        try log.append(HangRecord(at: Date(), seconds: 1, breadcrumb: Breadcrumbs.current))
        try log.append(HangRecord(at: Date(), seconds: 2, breadcrumb: "restore cache"))
        let taken = log.takeAll()
        #expect(taken.map(\.seconds) == [1, 2] && taken.map(\.breadcrumb) == ["apply hub", "restore cache"])
        #expect(log.takeAll().isEmpty, "each hang is reported once")
        Breadcrumbs.mark("idle")
        #expect(Breadcrumbs.around("persist") { Breadcrumbs.current } == "persist" && Breadcrumbs.current == "idle")
    }

    // MARK: Coordinator

    @Test func theCoordinatorLivesOnTheHubMachineAndItsSessionIsCachedOnceItExists() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try hubModel(rig, sandbox)
                await model.start()
                _ = try await waitUntil { await MainActor.run { model.machines.endpoints.count == 3 } }
                let hubMachine = HubIdentity.machineID(name: HubRig.hubName)
                #expect(model.hubMachineID == hubMachine, "always the hub, no picker")
                #expect(model.coordinatorRef == nil && model.coordinatorPendingRef == .pendingCoordinator(on: hubMachine))
                model.askCoordinatorQueued("What needs me?", on: hubMachine)
                #expect(model.outbox.pending(for: .pendingCoordinator(on: hubMachine)).first?.statusLabel == "Queued")
                let created = try await waitUntil(timeout: .seconds(20)) { await MainActor.run { model.coordinatorSessionID != nil } }
                #expect(created, "the session exists: the same screen shows its feed now")
                #expect(sandbox.cache.loadCoordinatorID() == model.coordinatorSessionID)
                model.stop()

                let relaunched = try hubModel(rig, sandbox)
                await relaunched.start()
                #expect(relaunched.coordinatorSessionID == sandbox.cache.loadCoordinatorID(), "known at launch, before any answer")
                relaunched.stop()
            }
        }
    }
}

/// A counter the writer's callback can bump from its own thread.
private final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.withLock { count += 1 } }
    var value: Int { lock.withLock { count } }
}
