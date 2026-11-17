@testable import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Observation
import Testing

/// Batch 2 of docs/FIX-LIST-2026-11-16.md: observation granularity, off-main persistence, one push registration, sessions.
@MainActor
struct ResponsivenessBatch2Tests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: P1-1 observation granularity

    @Test func anUnchangedHubPollWakesNoObserver() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await sandbox.startedHubModel(for: rig)
                let settled = try await waitUntil {
                    await MainActor.run { model.streams.count == 2 && (try? model.state.machine(id: HubIdentity.machineID(name: HubRig.peerName)))?.isOnline == true }
                }
                #expect(settled)
                await model.pollHub()
                await model.pollHub()
                let woken = Counter()
                withObservationTracking {
                    _ = model.state
                    _ = model.machines
                    _ = model.hubStatus
                    _ = model.needsYou
                    _ = model.connectivityBanner
                } onChange: { woken.increment() }
                await model.pollHub()
                await model.pollHub()
                #expect(woken.value == 0, "an unchanged poll changes nothing a screen shows")
                model.stop()
            }
        }
    }

    @Test func pingsAndRepeatedHellosOnlyCountWhenTheyMoveSomething() throws {
        var machine = MachineState(endpoint: Fixtures.endpoint("Studio"))
        let hello = try Fixtures.event("helloWithSessions")
        #expect(machine.wouldChange(by: hello))
        machine.apply(hello)
        #expect(!machine.wouldChange(by: hello))
        machine.apply(.ping(ts: now))
        #expect(!machine.wouldChange(by: .ping(ts: now.addingTimeInterval(5))), "a ping within 30 s is not news")
        #expect(machine.wouldChange(by: .ping(ts: now.addingTimeInterval(31))))
        guard case .hello(_, let sessions) = hello, let first = sessions.first else { return }
        #expect(!machine.wouldChange(by: .session(first)))
    }

    @Test func aHubAnswerThatOnlyJittersTheLatencyIsNotAChange() {
        var machine = MachineState(endpoint: Fixtures.endpoint("Linux"))
        let first = HubMachine(name: "Linux", online: true, hub: true, lastSeen: now, latencyMs: 12, sessions: 3)
        machine.apply(hub: first)
        let jitter = HubMachine(name: "Linux", online: true, hub: true, lastSeen: now.addingTimeInterval(5), latencyMs: 31, sessions: 3)
        #expect(!machine.wouldChange(by: jitter))
        #expect(machine.wouldChange(by: HubMachine(name: "Linux", online: true, hub: true, lastSeen: now, latencyMs: 250, sessions: 3)))
        #expect(machine.wouldChange(by: HubMachine(name: "Linux", online: true, hub: true, lastSeen: now, latencyMs: 12, sessions: 4)))
        #expect(machine.wouldChange(by: HubMachine(name: "Linux", online: false, problem: "gone")))
    }

    @Test func machinesKeepTheirSessionsSortedAndTheFeedKeepsItsBlocks() throws {
        var machine = MachineState(endpoint: Fixtures.endpoint("Studio"))
        machine.apply(try Fixtures.event("helloWithSessions"))
        let expected = SessionOrdering.sorted(machine.sessions)
        #expect(machine.activeSessions + machine.endedSessions == expected)
        #expect(machine.endedSessions.allSatisfy { $0.status == .ended } && machine.activeSessions.allSatisfy { $0.status != .ended })

        var feed = SessionFeed(page: try Fixtures.page("everyActivityKind"))
        #expect(feed.blocks == FeedBlock.group(feed.rows) && !feed.blocks.isEmpty)
        let extra = try Fixtures.activity("user")
        feed.upsert(extra)
        #expect(feed.blocks == FeedBlock.group(feed.rows), "blocks follow every change")
        feed.refresh(with: try Fixtures.page(items: [extra], nextBefore: nil))
        #expect(feed.blocks == FeedBlock.group(feed.rows))
        #expect(SessionFeed(snapshot: feed.snapshot()).blocks == feed.blocks)
    }

    @Test func theTailscaleInterfaceIsReadWhenConnectionsChangeNotOnEveryUpdate() async throws {
        try await StoreSandbox.with { sandbox in
            let reads = Counter()
            let endpoint = Fixtures.endpoint("Studio")
            var list = MachineList()
            list.add(endpoint)
            try sandbox.machinesFile.save(list)
            try sandbox.keychainTokens.save("token", endpoint.id)
            let config = AppModelConfiguration(
                machinesFile: sandbox.machinesFile, tokens: sandbox.keychainTokens, cache: sandbox.cache, deviceName: "t",
                requestTimeout: 1, tailscaleIsOn: { reads.increment(); return true }, telemetryFile: sandbox.telemetryFile
            )
            let model = AppModel(configuration: config)
            await model.start()
            model.markOffline(endpoint.id)
            let afterOffline = reads.value
            for _ in 0..<20 { model.stateChanged() }
            #expect(reads.value == afterOffline, "same connections: the interface is not read again")
            #expect(model.connectivityBanner == .tailscaleOnButSilent)
            model.stop()
        }
    }

    // MARK: P1-2 / P1-3 persistence off the calling thread

    @Test func theTelemetryQueueWritesOnceAfterAQuietTimeNotOnEveryReport() async throws {
        let file = try StoreSandbox().root.appending(path: "queue.json")
        let queue = TelemetryQueue(file: file, persistDelay: 0.15)
        for index in 0..<50 { queue.enqueue(TelemetryReport(at: Date(), message: "e\(index)", area: "a", appVersion: "1", build: "1", platform: "t", kind: .event)) }
        #expect(!FileManager.default.fileExists(atPath: file.path), "nothing on disk yet")
        try await Task.sleep(for: .milliseconds(600))
        #expect(TelemetryQueue(file: file).pending.count == 50)
    }

    @Test func theCacheWriterCoalescesSkipsUnchangedValuesAndNeverWritesAfterAWipe() throws {
        let sandbox = try StoreSandbox()
        let writer = CacheWriter(cache: sandbox.cache, machinesFile: sandbox.machinesFile, delay: 0.05)
        let id = UUID()
        func snapshot(_ lastSeen: TimeInterval) -> MachineSnapshot {
            MachineSnapshot(machineID: id, machine: nil, sessions: [], lastSeen: Date(timeIntervalSince1970: lastSeen))
        }
        for index in 0..<40 { writer.save(snapshot(Double(index))) }
        writer.flush()
        #expect(writer.writes == 1, "forty changes, one file write")
        #expect(sandbox.cache.load(machineID: id)?.lastSeen == Date(timeIntervalSince1970: 39))
        writer.save(snapshot(39))
        writer.flush()
        #expect(writer.writes == 1, "the same value again writes nothing")

        writer.save(snapshot(100))
        try writer.wipe { try sandbox.cache.removeAll() }
        writer.flush()
        #expect(sandbox.cache.load(machineID: id) == nil && writer.writes == 0, "a wipe drops what was waiting")
    }

    @Test func machineSnapshotsReachTheDiskThroughTheWriterNotInline() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                model.cacheWriter.flush()
                #expect(sandbox.cache.load(machineID: endpoint.id)?.sessions.count == SeedSession.standard.count)
                let before = model.cacheWriter.writes
                model.persist(endpoint.id)
                model.cacheWriter.flush()
                #expect(model.cacheWriter.writes == before, "an unchanged snapshot is not written again")
                model.stop()
            }
        }
    }

    // MARK: P1-4 push, P1-5 sessions

    @Test func pushIsRegisteredOncePerLaunchAndOnlyOnTheHubInHubMode() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await sandbox.startedHubModel(for: rig)
                let token = String(repeating: "ab", count: 32)
                await model.registerPush(apnsToken: token, environment: .sandbox)
                let key = try #require(model.pushRegistrationKey)
                await model.registerPush(apnsToken: token, environment: .sandbox)
                #expect(model.pushRegistrationKey == key)
                #expect(model.lastError == nil, "the hub took the registration")
                await model.registerPush(apnsToken: token, environment: .sandbox, notifications: [.done])
                #expect(model.pushRegistrationKey != key, "other choices register again")
                model.stop()
            }
        }
    }

    @Test func httpAndStreamsUseTheirOwnSessionsAndStreamsWaitForThreePings() {
        #expect(FardeskSessions.http !== FardeskSessions.stream)
        #expect(FardeskSessions.streamTimeout >= 3 * FardeskSessions.daemonPingInterval)
        let api = FardeskAPI(baseURL: URL(string: "http://127.0.0.1:1")!, token: nil, timeout: 15)
        #expect(EventStream(api: api).makeRequest().timeoutInterval >= 60, "the stream timeout is not the 15 s of a plain call")
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.withLock { count += 1 } }
    var value: Int { lock.withLock { count } }
}
