import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// What the owner felt on the phone, against a REAL hub: every wait has words, every message shows at once.
@MainActor
struct HubResponsivenessTests {
    private func hubModel(_ rig: HubRig, _ sandbox: StoreSandbox, waitForPeer: Bool = true) async throws -> AppModel {
        try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: rig.hub.url))
        let model = AppModel(configuration: sandbox.configuration(hub: rig.hub.link))
        await model.start()
        if waitForPeer {
            let ready = try await waitUntil {
                await MainActor.run { (try? model.state.machine(id: HubIdentity.machineID(name: HubRig.peerName)))?.isOnline == true }
            }
            #expect(ready)
        }
        return model
    }

    private func openEdits(_ model: AppModel) async -> SessionRef {
        let ref = SessionRef(machineID: peerID, sessionID: SeedSession.editsSessionID)
        await model.openSession(ref)
        return ref
    }

    private var peerID: UUID { HubIdentity.machineID(name: HubRig.peerName) }

    @Test func onlyAHubTokenOpensTheAppInHubMode() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let old = HubIdentity.endpoint(machine: "Mac mini Pro", hub: rig.hub.link)
                var list = MachineList()
                list.setHub(rig.hub.link)
                list.replaceEndpoints([old])
                try sandbox.machinesFile.save(list)
                try sandbox.keychainTokens.save(TestDaemon.token, old.id)
                let model = AppModel(configuration: sandbox.configuration(hub: rig.hub.link))
                await model.start()
                #expect(model.phase == .loggedOut, "a login to another machine is no login to the hub")
                #expect(model.machines.endpoints.map(\.name) == ["Mac mini Pro"], "its name stays on screen")
            }
        }
    }

    @Test func anUnreachableHubSaysSoWithTheReasonAndAnEvent() async throws {
        try await StoreSandbox.with { sandbox in
            let gone = HubLink(url: URL(string: "http://127.0.0.1:\(try freePort())")!)
            try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: gone.url))
            let model = AppModel(configuration: sandbox.configuration(hub: gone))
            var list = MachineList()
            list.setHub(gone)
            list.replaceEndpoints([HubIdentity.endpoint(machine: "Linux", hub: gone)])
            try sandbox.machinesFile.save(list)
            await model.start()
            #expect(model.hubBannerText?.hasPrefix("Connecting to the hub") == true)
            let said = try await waitUntil { await MainActor.run { model.hubStatus?.isUnreachable == true } }
            #expect(said)
            let text = try #require(model.hubBannerText)
            #expect(text.hasPrefix("Can't reach the hub (Linux, 127.0.0.1): ") && text.hasSuffix("Retrying..."), "\(text)")
            #expect(model.configuration.telemetry.pending.contains { $0.area == "hub" && $0.message.hasPrefix("the hub does not answer: ") })
            model.stop()
        }
    }

    @Test func aMessageShowsQueuedAtOnceThenBecomesClaudeGotItWhenTheTranscriptRowArrives() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let ref = SessionRef(machineID: peerID, sessionID: SeedSession.hookSessionID)
                await model.openSession(ref)
                let signal = model.sendSignal
                let result = await model.submit(OutgoingMessage(text: "queued before the call returns"), to: ref)
                #expect(result == .sent)
                let shown = try #require(model.outbox.pending(for: ref).first, "in the feed before any HTTP call could return")
                #expect(shown.statusLabel == "Queued" && model.sendSignal == signal + 1, "no rule holds the message back")

                try rig.peer.appendUserPrompt("queued before the call returns", toSession: SeedSession.hookSessionID)
                let got = try await waitUntil { await MainActor.run { model.outbox.pending(for: ref).isEmpty } }
                #expect(got, "the transcript row replaced the pending message")
                let feed = model.feeds.feed(for: SessionRef(machineID: peerID, sessionID: ref.sessionID))
                let rowID = try #require(feed.activities.compactMap { row -> String? in
                    if case .user(let user) = row, user.text == "queued before the call returns" { user.id } else { nil }
                }.first)
                #expect(model.outbox.isDelivered(rowID: rowID))
                model.stop()
            }
        }
    }

    @Test func aMessageToAnOfflineMachineStaysQueuedAndNamesTheWait() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let dead = SessionRef(machineID: HubIdentity.machineID(name: HubRig.deadName), sessionID: "x")
                _ = await model.submit(OutgoingMessage(text: "later"), to: dead)
                #expect(model.outbox.pending(for: dead).first?.statusLabel == "Queued")
                let waiting = try await waitUntil {
                    await MainActor.run { model.outbox.pending(for: dead).first?.statusLabel == "Queued - waiting for \(HubRig.deadName)" }
                }
                #expect(waiting)
                #expect(model.lastError == nil)
                model.stop()
            }
        }
    }

    @Test func aRejectedMessageSaysWhyAndCanBeRetried() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let unknown = SessionRef(machineID: peerID, sessionID: "no-such-session")
                _ = await model.submit(OutgoingMessage(text: "hello?"), to: unknown)
                let failed = try await waitUntil { await MainActor.run { model.outbox.pending(for: unknown).first?.canRetry == true } }
                #expect(failed)
                let message = try #require(model.outbox.pending(for: unknown).first)
                #expect(message.statusLabel.hasPrefix("Not sent: "))
                model.retry(message.id)
                #expect(model.outbox.message(message.id)?.statusLabel == "Queued")
                model.discard(message.id)
                #expect(model.outbox.pending(for: unknown).isEmpty)
                model.stop()
            }
        }
    }

    @Test func startingASessionOpensAtOnceWithStepsAndAFailureHasItsReason() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let request = NewSessionRequest(cwd: "/no/such/dir", prompt: "x", worktree: false, model: nil)
                let placeholder = model.startNewSession(request, on: peerID)
                #expect(placeholder.isStarting)
                let first = try #require(model.stepLogs[placeholder]?.steps.first, "the step exists before the call returns")
                #expect(first.text == "Starting Claude on \(HubRig.peerName)..." && first.state == .running)
                let ended = try await waitUntil { await MainActor.run { model.stepLogs[placeholder]?.isRunning == false } }
                #expect(ended)
                #expect(model.stepLogs[placeholder]?.hasFailure == true)
                #expect(model.stepLogs[placeholder]?.steps.first?.displayText.hasPrefix("Starting Claude on") == true)
                #expect(model.startedSessions[placeholder] == nil)
                #expect(model.failureSignal > 0, "a failed start is felt; the step log says why")
                model.stop()
            }
        }
    }

    @Test func resumeAndClearShowTheirStepsOnTheSessionYouAreIn() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let ref = SessionRef(machineID: peerID, sessionID: SeedSession.endedSessionID)
                _ = await model.clear(ref)
                #expect(model.stepLogs[ref]?.steps.first?.text == "Clearing the context on \(HubRig.peerName)...")
                #expect(model.stepLogs[ref]?.hasFailure == true, "the daemon refuses to clear an ended session, and the log says so")
                model.stop()
            }
        }
    }

    @Test func openingWithoutACacheLoadsAFirstPageWithAStepAndWithOneStaysSilent() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let ref = await openEdits(model)
                let log = try #require(model.stepLogs[ref])
                #expect(log.steps.count == 1 && log.steps[0].state == .done)
                #expect(log.steps[0].text.hasPrefix("Loaded "))
                #expect(!log.isVisible(feedHasRows: true), "once rows show, the log leaves")
                await model.openSession(ref)
                #expect(model.stepLogs[ref]?.steps.count == 1, "a cached open adds no step")
                model.stop()
            }
        }
    }

    @Test func theCoordinatorOpensOnTheHubAndItsFirstMessageIsQueuedAtOnce() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await hubModel(rig, sandbox)
                let machine = try #require(CoordinatorPresentation.defaultMachine(in: model.state.machines))
                #expect(machine.endpoint.name == HubRig.hubName)
                let pending = SessionRef.pendingCoordinator(on: machine.id)
                model.askCoordinatorQueued("What needs me?", on: machine.id)
                #expect(model.outbox.pending(for: pending).first?.statusLabel == "Queued")
                let answered = try await waitUntil { await MainActor.run { model.stepLogs[pending]?.isRunning == false } }
                #expect(answered, "the coordinator call ended with a visible state")
                let steps = try #require(model.stepLogs[pending]?.steps)
                #expect(steps.count == 1 && (steps[0].text.hasPrefix("Session started") || steps[0].state != .done))
                if let real = model.startedSessions[pending] {
                    #expect(model.outbox.pending(for: real).first?.kind == .reply, "the first message moved to the session it started")
                    #expect(model.stepLogs[real]?.steps.last?.text == "Waiting for the first answer...")
                }
                model.stop()
            }
        }
    }

    @Test func pairingInHubModeRefusesAForeignLinkAndChecksTheHubsLink() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                var list = MachineList()
                list.setHub(rig.hub.link)
                try sandbox.machinesFile.save(list)
                let model = AppModel(configuration: sandbox.configuration(hub: rig.hub.link))
                await model.start()
                #expect(model.phase == .loggedOut)
                await model.pair(link: try await PairingLinks.make(for: rig.peer, name: "Peer", hub: true))
                #expect(model.loginError?.contains("not for the hub") == true && model.phase == .loggedOut)
                await model.pair(link: try PairingLinks.make(url: rig.hub.url, name: "Linux", code: String(repeating: "cd", count: 32), hub: true))
                #expect(model.loginError?.hasPrefix("Pairing failed") == true && model.phase == .loggedOut)
                await model.pair(link: try await PairingLinks.make(for: rig.hub, name: "Linux", hub: true))
                #expect(model.phase == .ready && model.loginError == nil)
                #expect(model.notices[.list]?.text == "Paired with the hub (\(HubRig.hubName))")
                model.stop()
            }
        }
    }
}
