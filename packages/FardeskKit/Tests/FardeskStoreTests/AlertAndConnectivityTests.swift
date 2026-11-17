import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

struct ErrorTextTests {
    @Test func bareSystemTextsGetTheirDomainAndCode() {
        let unknown = NSError(domain: NSURLErrorDomain, code: -1, userInfo: [NSLocalizedDescriptionKey: "unknown error"])
        #expect(ErrorText.detail(unknown) == "unknown error (NSURLErrorDomain -1)")
        let empty = NSError(domain: "X", code: 7, userInfo: [NSLocalizedDescriptionKey: ""])
        #expect(ErrorText.detail(empty) == "X 7")
        #expect(ErrorText.detail(MachineAccessError.notLoggedIn(machine: "A")) == "Not logged in to A. Log in first.")
    }

    @Test func messageNamesMachineAndAction() {
        let unknown = NSError(domain: NSURLErrorDomain, code: -1, userInfo: [NSLocalizedDescriptionKey: "unknown error"])
        let text = ErrorText.message(machine: "Mac Studio M2", action: "load activity", error: unknown)
        #expect(text == "Mac Studio M2: could not load activity: unknown error (NSURLErrorDomain -1)")
        #expect(!text.hasPrefix("unknown error"))
    }

    @Test func cancellationIsRecognisedInEveryShape() {
        #expect(URLError(.cancelled).isCancellation)
        #expect(CancellationError().isCancellation)
        #expect(FardeskAPIError.transport(URLError(.cancelled)).isCancellation)
        #expect(!URLError(.timedOut).isCancellation)
        #expect(!FardeskAPIError.decoding("x").isCancellation)
    }
}

struct AlertGateTests {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    private func admit(_ gate: inout AlertGate, _ message: String, showing: String?, now: Date) -> Bool {
        gate.admit(message, showing: showing, now: now)
    }

    @Test func onlyOneAlertAtATime() {
        var gate = AlertGate()
        #expect(admit(&gate, "A", showing: nil, now: start))
        #expect(!admit(&gate, "B", showing: "A", now: start))
        #expect(admit(&gate, "B", showing: nil, now: start))
    }

    @Test func theSameMessageIsNotRepeatedInsideTheWindow() {
        var gate = AlertGate()
        #expect(admit(&gate, "A", showing: nil, now: start))
        #expect(!admit(&gate, "A", showing: nil, now: start.addingTimeInterval(10)))
        #expect(admit(&gate, "A", showing: nil, now: start.addingTimeInterval(AlertGate.repeatWindow + 1)))
    }

    @Test func aRefusedMessageDoesNotResetTheWindow() {
        var gate = AlertGate()
        #expect(admit(&gate, "A", showing: nil, now: start))
        #expect(!admit(&gate, "B", showing: "A", now: start.addingTimeInterval(5)))
        #expect(!admit(&gate, "A", showing: nil, now: start.addingTimeInterval(30)))
    }
}

struct ConnectivityBannerTests {
    private func decide(_ connections: [ConnectionState], tailscale: Bool) -> ConnectivityBanner? {
        ConnectivityBanner.decide(connections: connections, tailscaleIsOn: { tailscale })
    }

    @Test func noMachineAnswersAndNoTailscaleOffersToTurnItOn() {
        let banner = decide([.offline(lastSeen: nil), .offline(lastSeen: nil)], tailscale: false)
        #expect(banner == .notOnTailscale)
        #expect(banner?.text == "Not on Tailscale. Turn on Tailscale to reach your machines.")
        #expect(banner?.opensTailscale == true)
    }

    @Test func noMachineAnswersWithTailscaleOnSaysSo() {
        let banner = decide([.offline(lastSeen: nil)], tailscale: true)
        #expect(banner == .tailscaleOnButSilent)
        #expect(banner?.text == "Tailscale is on, but no machine answers.")
        #expect(banner?.opensTailscale == false)
    }

    @Test func oneMachineAnsweringMeansNoBanner() {
        #expect(decide([.offline(lastSeen: nil), .online, .offline(lastSeen: nil)], tailscale: false) == nil)
        #expect(decide([.loggedOut, .offline(lastSeen: nil)], tailscale: false) == nil)
    }

    @Test func stillConnectingOrNoMachinesMeansNoBanner() {
        #expect(decide([.connecting, .offline(lastSeen: nil)], tailscale: false) == nil)
        #expect(decide([], tailscale: false) == nil)
    }

    @Test func theProbeIsOnlyAskedWhenNothingAnswers() {
        var asked = false
        _ = ConnectivityBanner.decide(connections: [.online], tailscaleIsOn: { asked = true; return false })
        #expect(!asked)
    }

    @Test func theRealInterfaceProbeAnswersWithoutCrashing() {
        let first = TailscaleInterface.isUp()
        #expect(TailscaleInterface.isUp() == first)
    }

    @Test func cgnatRangeIsTailscalesAddressSpace() {
        func address(_ a: UInt32, _ b: UInt32, _ c: UInt32, _ d: UInt32) -> UInt32 { a << 24 | b << 16 | c << 8 | d }
        #expect(TailscaleInterface.isCGNAT(address(100, 64, 0, 1)))
        #expect(TailscaleInterface.isCGNAT(address(100, 121, 97, 43)))
        #expect(TailscaleInterface.isCGNAT(address(100, 127, 255, 255)))
        #expect(!TailscaleInterface.isCGNAT(address(100, 63, 255, 255)))
        #expect(!TailscaleInterface.isCGNAT(address(100, 128, 0, 0)))
        #expect(!TailscaleInterface.isCGNAT(address(192, 168, 1, 2)))
    }
}

@MainActor
struct SingleMachineModeTests {
    private func addDead(_ name: String, port: Int = 9, to sandbox: StoreSandbox) throws -> MachineEndpoint {
        let dead = MachineEndpoint(name: name, url: URL(string: "http://127.0.0.1:\(port)")!)
        var list = try sandbox.machinesFile.load()
        list.add(dead)
        try sandbox.machinesFile.save(list)
        try sandbox.keychainTokens.save("x", dead.id)
        return dead
    }

    private func settled(_ model: AppModel, _ ids: [UUID]) async throws {
        let done = try await waitUntil {
            await MainActor.run { ids.allSatisfy { if case .offline? = (try? model.state.machine(id: $0))?.connection { true } else { false } } }
        }
        #expect(done)
    }

    @Test func twoDeadMachinesNeverAlertAndTheLiveOneWorksFully() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let deadA = try addDead("Dead A", to: sandbox)
                let deadB = try addDead("Dead B", port: 1, to: sandbox)
                let (model, live) = try await readyModel(daemon, sandbox)
                try await settled(model, [deadA.id, deadB.id])
                await model.refresh()
                let session = SessionRef(machineID: live.id, sessionID: SeedSession.editsSessionID)
                await model.openSession(session)
                #expect(!(model.feeds.feed(for: SessionRef(machineID: live.id, sessionID: session.sessionID)).activities.isEmpty))
                #expect(await model.mute(true, session))
                #expect(await model.recentFolders(on: live.id) != nil)
                #expect(model.lastError == nil)
                #expect(model.connectivityBanner == nil)
                model.stop()
            }
        }
    }

    @Test func actionsOnADeadMachineFailQuietly() async throws {
        try await StoreSandbox.with { sandbox in
            let dead = try addDead("Dead A", to: sandbox)
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            try await settled(model, [dead.id])
            let ref = SessionRef(machineID: dead.id, sessionID: "s")
            #expect(await !model.send("hi", to: ref))
            await model.openSession(ref)
            #expect(await model.recentFolders(on: dead.id) == nil)
            #expect(model.lastError == nil)
            #expect(ErrorText.message(machine: "Dead A", action: "x", error: URLError(.timedOut)).hasPrefix("Dead A:"))
            model.stop()
        }
    }

    @Test func aUserActionOnAReachableMachineThatDropsSaysSoInItsSessionNotInAnAlert() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                model.stop()
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.editsSessionID)
                await daemon.stopServer()
                #expect(await !model.send("one", to: ref))
                let notice = try #require(model.notices[.session(ref)])
                #expect(notice.state == .failed)
                #expect(notice.text.hasPrefix("Could not send the message on box: "))
                #expect(!notice.text.lowercased().contains("unknown error"))
                #expect(model.lastError == nil, "the failure is in the session, not over the app")
                #expect(model.notices[.list] == nil)
            }
        }
    }

    @Test func aCancelledRequestIsSilent() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.editsSessionID)
                for _ in 0..<5 {
                    let open = Task { await model.openSession(ref) }
                    open.cancel()
                    await open.value
                }
                #expect(model.lastError == nil)
                #expect(try model.state.machine(id: endpoint.id).isOnline)
                model.stop()
            }
        }
    }

    @Test func serverErrorsFromSeveralSessionActionsAreOneLineInThatSessionAndNoAlert() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let unknown = SessionRef(machineID: endpoint.id, sessionID: "does-not-exist")
                await model.openSession(unknown)
                #expect(model.stepLogs[unknown]?.hasFailure == true, "the open says in the session why nothing shows")
                _ = await model.stop(unknown)
                #expect(model.notices[.session(unknown)]?.text.hasPrefix("Could not stop the session on box: ") == true)
                _ = await model.kill(unknown)
                #expect(model.notices[.session(unknown)]?.text.hasPrefix("Could not end the session on box: ") == true, "one line, the latest")
                #expect(model.lastError == nil)
                model.leaveSession(unknown)
                #expect(model.notices[.session(unknown)] == nil && model.stepLogs[unknown] == nil)
                model.stop()
            }
        }
    }

    @Test func bannerShowsWhenEveryMachineIsDead() async throws {
        try await StoreSandbox.with { sandbox in
            let dead = try addDead("Dead A", to: sandbox)
            let configuration = AppModelConfiguration(
                machinesFile: sandbox.machinesFile, tokens: sandbox.keychainTokens, cache: sandbox.cache,
                deviceName: "t", requestTimeout: 2, backoff: BackoffPolicy(initial: 0.05, maximum: 0.2, jitter: 0),
                tailscaleIsOn: { false }
            )
            let model = AppModel(configuration: configuration)
            await model.start()
            try await settled(model, [dead.id])
            #expect(model.connectivityBanner == .notOnTailscale)
            model.stop()
        }
    }
}
