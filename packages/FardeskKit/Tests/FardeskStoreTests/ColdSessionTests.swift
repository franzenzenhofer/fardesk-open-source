import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

struct ColdSessionTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func session(tokens: Int?, expires: Date?, status: String = "idle", updated: Date? = nil) throws -> SessionSummary {
        let format = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        var overrides: [String: any Sendable] = [
            "contextTokens": tokens.map { $0 as any Sendable } ?? NSNull(),
            "cacheExpiresAt": expires.map { format.format($0) as any Sendable } ?? NSNull(),
            "status": status,
            "waitingFor": NSNull(),
        ]
        if let updated { overrides["updatedAt"] = format.format(updated) }
        return try Fixtures.session("idleResume", overriding: overrides)
    }

    @Test func coldNeedsAnExpiredCacheAndAtLeast20kTokens() {
        let past = now.addingTimeInterval(-60), future = now.addingTimeInterval(60)
        #expect(ColdSession.isCold(contextTokens: 426_323, cacheExpiresAt: past, now: now))
        #expect(ColdSession.isCold(contextTokens: 20_000, cacheExpiresAt: past, now: now), "the threshold itself is cold")
        #expect(!ColdSession.isCold(contextTokens: 19_999, cacheExpiresAt: past, now: now))
        #expect(!ColdSession.isCold(contextTokens: 426_323, cacheExpiresAt: future, now: now), "cache still warm")
        #expect(!ColdSession.isCold(contextTokens: 426_323, cacheExpiresAt: now, now: now), "expires exactly now is not yet expired")
        #expect(!ColdSession.isCold(contextTokens: nil, cacheExpiresAt: past, now: now), "unknown size: never asks")
        #expect(!ColdSession.isCold(contextTokens: 426_323, cacheExpiresAt: nil, now: now), "unknown expiry: never asks")
    }

    @Test func aSessionSummaryCarriesTheNewFieldsAndOldOnesDecodeWithoutThem() throws {
        let cold = try session(tokens: 426_323, expires: now.addingTimeInterval(-3_600))
        #expect(cold.contextTokens == 426_323 && ColdSession.isCold(cold, now: now))
        let unknown = try session(tokens: nil, expires: nil)
        #expect(unknown.contextTokens == nil && unknown.cacheExpiresAt == nil && !ColdSession.isCold(unknown, now: now))
        let old = Data(#"{"id":"x","title":"t","cwd":"/a","status":"idle","waitingFor":null,"owned":false,"replyMode":"resume","canStop":false,"summary":"s","model":null,"pid":null,"muted":false,"startedAt":"2026-11-16T09:30:00.000Z","updatedAt":"2026-11-16T09:30:00.000Z"}"#.utf8)
        let decoded = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: old)
        #expect(decoded.contextTokens == nil && decoded.cacheExpiresAt == nil)
    }

    @Test func tokensAndIdleTimeReadShort() {
        #expect(ColdSession.tokensLabel(426_323) == "426k")
        #expect(ColdSession.tokensLabel(20_000) == "20k")
        #expect(ColdSession.tokensLabel(950) == "950")
        #expect(ColdSession.tokensLabel(1_200_000) == "1.2M")
        #expect(ColdSession.idleLabel(since: now.addingTimeInterval(-30), now: now) == "1 min")
        #expect(ColdSession.idleLabel(since: now.addingTimeInterval(-45 * 60), now: now) == "45 min")
        #expect(ColdSession.idleLabel(since: now.addingTimeInterval(-3 * 3_600 - 60), now: now) == "3 h")
        #expect(ColdSession.idleLabel(since: now.addingTimeInterval(-2 * 86_400), now: now) == "2 d")
    }

    @Test func theWarningUsesClaudeCodesWords() throws {
        let cold = try session(tokens: 426_323, expires: now.addingTimeInterval(-60), updated: now.addingTimeInterval(-3 * 3_600))
        #expect(ColdSession.warning(cold, now: now) == "Resume this conversation? Inactive for 3 h and 426k tokens long. Continuing re-reads all of it.")
    }

    @Test func choicesAndActionsFollowTheSessionState() throws {
        let running = try session(tokens: 100_000, expires: now.addingTimeInterval(-1))
        let ended = try session(tokens: 100_000, expires: now.addingTimeInterval(-1), status: "ended")
        #expect(ColdSession.choices(for: running, hasMessage: false) == [.resume, .summary, .startNew])
        #expect(ColdSession.choices(for: ended, hasMessage: true) == [.resume, .summary, .startNew])
        #expect(ColdSession.choices(for: ended, hasMessage: false) == [.resume, .summary], "nothing to start a new session with")
        #expect(ColdChoice.allCases.map(\.buttonTitle) == ["Resume", "Resume from summary", "Start new"])
        #expect(ColdSession.action(for: .resume, session: running) == .sendAsIs)
        #expect(ColdSession.action(for: .summary, session: ended) == .compactThenSend)
        #expect(ColdSession.action(for: .startNew, session: running) == .clearThenSend)
        #expect(ColdSession.action(for: .startNew, session: ended) == .newSessionWithPrompt)
    }

    @Test func compactAsTheWholeMessageIsTheCompactRoute() {
        #expect(OutgoingMessage(text: " /compact ").isCompactCommand)
        #expect(!OutgoingMessage(text: "/compact now").isCompactCommand)
    }
}

/// The cold card against a REAL daemon, with the "every session is cold" switch the UI tests use.
@MainActor
struct ColdCardModelTests {
    private func coldModel(_ daemon: TestDaemon, _ sandbox: StoreSandbox) async throws -> (AppModel, MachineEndpoint) {
        let endpoint = try sandbox.pair(daemon)
        let model = AppModel(configuration: sandbox.configuration(treatsEverySessionAsCold: true))
        await model.start()
        let online = try await waitUntil { await MainActor.run { (try? model.state.machine(id: endpoint.id))?.isOnline == true } }
        #expect(online)
        return (model, endpoint)
    }

    /// How many times the app tried to send a message (one event per try).
    @MainActor
    private static func sendAttempts(_ model: AppModel) -> Int {
        model.configuration.telemetry.pending.filter { $0.area == "action" && $0.message.hasPrefix("send the message:") }.count
    }

    private func withColdModel(_ body: (AppModel, MachineEndpoint) async throws -> Void) async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await coldModel(daemon, sandbox)
                try await body(model, endpoint)
            }
        }
    }

    @Test func aMessageToAColdSessionWaitsForTheChoiceAndStaysInTheFeed() async throws {
        try await withColdModel { model, endpoint in
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.hookSessionID)
                _ = await model.submit(OutgoingMessage(text: "after the break"), to: ref)
                let held = try #require(model.outbox.pending(for: ref).first)
                #expect(held.statusLabel == "Waiting for your choice" && model.coldHolds[ref]?.messageID == held.id)
                #expect(model.coldChoices(for: ref) == [.resume, .summary, .startNew])
                #expect(model.coldWarning(for: ref)?.hasPrefix("Resume this conversation? Inactive for ") == true)
                try await Task.sleep(for: .milliseconds(300))
                #expect(model.outbox.message(held.id)?.state == .held, "nothing was sent")

                model.cancelCold(for: ref)
                #expect(model.outbox.pending(for: ref).isEmpty && model.coldHolds[ref] == nil)
            model.stop()
        }
    }

    @Test func resumeSendsTheHeldMessageAndAnEndedSessionOffersNoStartNewWithoutOne() async throws {
        try await withColdModel { model, endpoint in
                let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.hookSessionID)
                _ = await model.submit(OutgoingMessage(text: "go on"), to: ref)
                let id = try #require(model.outbox.pending(for: ref).first?.id)
                _ = await model.chooseCold(.resume, for: ref)
                #expect(model.coldHolds[ref] == nil)
                #expect(model.outbox.message(id)?.state != .held, "the choice released the message")

                let ended = SessionRef(machineID: endpoint.id, sessionID: SeedSession.endedSessionID)
                _ = await model.beginResume(ended)
                #expect(model.coldHolds[ended]?.messageID == nil && model.coldHolds[ended] != nil, "a resume with no message asks first")
                #expect(model.coldChoices(for: ended) == [.resume, .summary])
            model.stop()
        }
    }

    @Test func resumeSendsTheHeldMessageExactlyOnce() async throws {
        try await withColdModel { model, endpoint in
            let ref = SessionRef(machineID: endpoint.id, sessionID: SeedSession.hookSessionID)
            let before = Self.sendAttempts(model)
            _ = await model.submit(OutgoingMessage(text: "once only"), to: ref)
            #expect(Self.sendAttempts(model) == before, "held: nothing is sent yet")
            _ = await model.chooseCold(.resume, for: ref)
            let settled = try await waitUntil { await MainActor.run { Self.sendAttempts(model) == before + 1 } }
            #expect(settled, "the choice sent it")
            _ = await model.chooseCold(.resume, for: ref)
            try await Task.sleep(for: .milliseconds(400))
            #expect(Self.sendAttempts(model) == before + 1, "a second tap on Resume finds nothing left to send")
            #expect(model.coldHolds[ref] == nil)
            model.stop()
        }
    }

    @Test func startNewOnAnEndedSessionStartsASessionInTheSameFolderWithTheMessageAsPrompt() async throws {
        try await withColdModel { model, endpoint in
                let ended = SessionRef(machineID: endpoint.id, sessionID: SeedSession.endedSessionID)
                _ = await model.submit(OutgoingMessage(text: "fresh start"), to: ended)
                let next = try #require(await model.chooseCold(.startNew, for: ended))
                #expect(next.isStarting, "the new session opens at once, with its steps")
                #expect(model.outbox.pending(for: ended).isEmpty)
                #expect(model.stepLogs[next]?.steps.first?.text.hasPrefix("Starting Claude on") == true)
            model.stop()
        }
    }
}
