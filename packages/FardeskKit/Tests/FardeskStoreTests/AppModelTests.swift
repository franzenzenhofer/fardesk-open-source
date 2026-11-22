import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Starts a paired model on a real daemon and waits until the machine is online.
@MainActor
func readyModel(_ daemon: TestDaemon, _ sandbox: StoreSandbox) async throws -> (AppModel, MachineEndpoint) {
    let endpoint = try sandbox.pair(daemon)
    let model = AppModel(configuration: sandbox.configuration())
    await model.start()
    let online = try await waitUntil { await MainActor.run { (try? model.state.machine(id: endpoint.id))?.isOnline == true } }
    #expect(online, "machine never came online")
    return (model, endpoint)
}

@MainActor
struct AppModelLifecycleTests {
    @Test func notPairedStartsLoggedOut() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            #expect(model.phase == .loggedOut)
            #expect(!model.isLoggedIn)
        }
    }

    @Test func pairedMachineGoesOnlineWithItsSessionsAndCachesThem() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                #expect(model.phase == .ready)
                let machine = try model.state.machine(id: endpoint.id)
                #expect(machine.sessions.count == SeedSession.standard.count)
                #expect(machine.machine?.name == "test-box")
                // The snapshot goes through the background cache writer: read the disk only after it wrote.
                model.cacheWriter.flush()
                #expect(sandbox.cache.load(machineID: endpoint.id)?.sessions.count == SeedSession.standard.count)
                model.stop()
            }
        }
    }

    @Test func secondLaunchShowsCachedSessionsBeforeTheStreamAnswers() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (first, endpoint) = try await readyModel(daemon, sandbox)
                first.stop()
                let second = AppModel(configuration: sandbox.configuration())
                await second.start()
                let cached = try second.state.machine(id: endpoint.id)
                #expect(cached.sessions.count == SeedSession.standard.count)
                #expect(!cached.isOnline)
            second.stop()
            }
        }
    }

    @Test func aCleanStartHasNoMachineAndShowsTheOnboarding() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            #expect(model.machines.endpoints.isEmpty)
            #expect(model.state.machines.isEmpty)
            #expect(model.phase == .loggedOut)
            #expect(model.needsOnboarding, "no machine and no hub: onboarding, not a password form")
            #expect(!model.isHubMode)
            #expect(!FileManager.default.fileExists(atPath: sandbox.machinesFile.url.path))
        }
    }

    @Test func aPairedMachineWithoutATokenStaysOutOfTheOnboardingCount() async throws {
        try await StoreSandbox.with { sandbox in
            try sandbox.machinesFile.save(MachineList(endpoints: [MachineEndpoint(name: "box", url: URL(string: "http://127.0.0.1:9")!)]))
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            #expect(model.phase == .loggedOut)
            #expect(!model.needsOnboarding)
        }
    }

    @Test func aCorruptMachineOrderIsSaidAloudAndFallsBackToAlphabetical() async throws {
        try await StoreSandbox.with { sandbox in
            try Data("not json".utf8).write(to: sandbox.machineOrderFile.url)
            let model = AppModel(configuration: sandbox.configuration())
            #expect(model.lastError?.contains("machine order is unreadable") == true)
            #expect(model.state.machineOrder.isEmpty)
        }
    }

    @Test func theMachineOrderTheUserChoseIsKeptOnTheDevice() async throws {
        try await StoreSandbox.with { sandbox in
            let machines = ["Alpha", "Beta", "Gamma"].enumerated().map {
                MachineEndpoint(name: $1, url: URL(string: "http://127.0.0.1:\(9 + $0)")!)
            }
            try sandbox.machinesFile.save(MachineList(endpoints: machines))
            for machine in machines { try sandbox.keychainTokens.save("x", machine.id) }
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            #expect(model.state.machines.map(\.endpoint.name) == ["Alpha", "Beta", "Gamma"])
            model.moveMachines(from: IndexSet(integer: 2), to: 0)
            #expect(model.state.machines.map(\.endpoint.name) == ["Gamma", "Alpha", "Beta"])
            #expect(try sandbox.machineOrderFile.load() == ["Gamma", "Alpha", "Beta"])
            model.stop()
            let second = AppModel(configuration: sandbox.configuration())
            await second.start()
            #expect(second.state.machines.map(\.endpoint.name) == ["Gamma", "Alpha", "Beta"])
            second.stop()
        }
    }

    @Test func unreachableMachineIsOfflineAndTheOthersStayOnline() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let dead = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
                try sandbox.machinesFile.save(MachineList(endpoints: [dead]))
                try sandbox.keychainTokens.save("x", dead.id)
                let (model, live) = try await readyModel(daemon, sandbox)
                let offline = try await waitUntil {
                    await MainActor.run { !((try? model.state.machine(id: dead.id))?.isOnline ?? true) }
                }
                #expect(offline)
                #expect(try model.state.machine(id: live.id).isOnline)
                model.stop()
            }
        }
    }

    @Test func refreshReloadsSessionsOverHttpAndMarksUnreachableOffline() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                model.stop()
                await model.refresh()
                #expect(try model.state.machine(id: endpoint.id).sessions.count == SeedSession.standard.count)
                await daemon.stopServer()
                await model.refresh()
                #expect(try !model.state.machine(id: endpoint.id).isOnline)
            }
        }
    }
}

@MainActor
struct AppModelFeedAndActionTests {
    private func ref(_ endpoint: MachineEndpoint, _ id: String = SeedSession.editsSessionID) -> SessionRef {
        SessionRef(machineID: endpoint.id, sessionID: id)
    }

    @Test func openSessionLoadsNewestPageThenOlderPagesUntilTheEnd() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let session = ref(endpoint)
                await model.openSession(session)
                let first = model.feeds.feed(for: SessionRef(machineID: endpoint.id, sessionID: session.sessionID))
                #expect(!first.activities.isEmpty)
                guard first.canLoadMore else { return model.stop() }
                await model.loadOlder(session)
                let second = model.feeds.feed(for: SessionRef(machineID: endpoint.id, sessionID: session.sessionID))
                #expect(second.activities.count > first.activities.count)
                model.stop()
            }
        }
    }

    @Test func liveActivityArrivesInTheFeedThroughTheStream() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                try daemon.appendUserPrompt("typed in the terminal", toSession: SeedSession.hookSessionID)
                let arrived = try await waitUntil {
                    await MainActor.run {
                        let feed = model.feeds.feed(for: SessionRef(machineID: endpoint.id, sessionID: SeedSession.hookSessionID))
                        return feed.activities.contains { if case .user(let u) = $0 { u.text == "typed in the terminal" } else { false } }
                    }
                }
                #expect(arrived)
                model.stop()
            }
        }
    }

    @Test func detailAndFoldersComeFromTheMachine() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                await model.openSession(ref(endpoint))
                let feed = model.feeds.feed(for: SessionRef(machineID: endpoint.id, sessionID: SeedSession.editsSessionID))
                let withDetail = feed.activities.compactMap { item -> String? in
                    if case .tool(let tool) = item, tool.hasDetail { tool.id } else { nil }
                }
                if let id = withDetail.first {
                    #expect(await model.detail(activityID: id, in: ref(endpoint))?.activityId == id)
                }
                #expect(await model.recentFolders(on: endpoint.id) != nil)
                model.stop()
            }
        }
    }

    @Test func rejectedActionsSetLastErrorAndReturnFalseOrNil() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let unknown = ref(endpoint, "does-not-exist")
                #expect(await !model.send("hi", to: unknown))
                #expect(model.notices[.session(unknown)]?.state == .failed, "the failure is in the session")
                #expect(await !model.decide(.allow, requestID: "r", in: unknown))
                #expect(await !model.answer("a", requestID: "q", in: unknown))
                #expect(await !model.stop(unknown))
                #expect(await !model.kill(unknown))
                #expect(await !model.mute(true, unknown))
                #expect(await model.resume(unknown) == nil)
                #expect(await model.takeover(unknown) == nil)
                #expect(await model.fork(unknown) == nil)
                let missingFolder = NewSessionRequest(cwd: "/no/such/dir", prompt: "x", worktree: false, model: nil)
                #expect(await model.newSession(missingFolder, on: endpoint.id) == nil)
                model.stop()
            }
        }
    }

    @Test func unknownMachineIsReportedNotCrashed() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            #expect(await model.recentFolders(on: UUID()) == nil)
            #expect(model.lastError?.contains("No machine") == true)
            await model.openSession(SessionRef(machineID: UUID(), sessionID: "x"))
            await model.loadOlder(SessionRef(machineID: UUID(), sessionID: "x"))
        }
    }

    @Test func registeringPushNeverCrashesAndDevicesListsEveryMachine() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                await model.registerPush(apnsToken: String(repeating: "ab", count: 32), environment: .sandbox)
                let devices = await model.devices()
                #expect(devices.map(\.machineID) == [endpoint.id])
                model.stop()
            }
        }
    }

    @Test func devicesShowReachableMachinesAndMarkTheOthersUnreachable() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let dead = MachineEndpoint(name: "gone", url: try #require(URL(string: "http://127.0.0.1:9")))
                var list = try sandbox.machinesFile.load()
                list.add(dead)
                try sandbox.machinesFile.save(list)
                try sandbox.keychainTokens.save(TestDaemon.token, dead.id)
                let other = AppModel(configuration: sandbox.configuration())
                await other.start()
                let started = ContinuousClock.now
                let devices = await other.devices(timeout: 2)
                #expect(ContinuousClock.now - started < .seconds(10))
                #expect(devices.map(\.machineID) == [endpoint.id, dead.id])
                #expect(devices[0].problem == nil)
                #expect(devices[1].problem == MachineDevices.unreachableProblem)
                #expect(devices[1].devices.isEmpty)
                model.stop()
                other.stop()
            }
        }
    }

    @Test func devicesReportAMachineWithoutAToken() async throws {
        try await StoreSandbox.with { sandbox in
            let endpoint = MachineEndpoint(name: "loose", url: try #require(URL(string: "http://127.0.0.1:9")))
            var list = try sandbox.machinesFile.load()
            list.add(endpoint)
            try sandbox.machinesFile.save(list)
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            let devices = await model.devices()
            #expect(devices.first?.problem?.contains("Not logged in") == true)
        }
    }
}
