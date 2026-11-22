import FardeskClient
import FardeskDemo
import FardeskModels
import Foundation
import Testing

/// The demo world answers the same `FardeskService` the HTTP client answers; every test here is real code on the real
/// fixture file (no mocks): the demo's own data, decoded with the one wire decoder.
struct DemoWorldTests {
    private let fast = Duration.milliseconds(20)

    private func world(clock: @escaping @Sendable () -> Date = { Date() }) throws -> DemoWorld {
        try DemoWorld(replyDelay: fast, clock: clock)
    }

    private func service(_ world: DemoWorld, _ name: String) throws -> any FardeskService {
        let machine = try #require(world.machines.first { $0.name == name })
        return try world.service(for: machine.id)
    }

    private func waiting(_ service: any FardeskService, _ reason: WaitingReason) async throws -> SessionSummary {
        try #require(try await service.sessions().first { $0.waitingFor == reason })
    }

    private func nextEvent(_ world: DemoWorld, where match: @Sendable (StreamEvent) -> Bool) async -> StreamEvent? {
        for await change in world.events where match(change.event) { return change.event }
        return nil
    }

    @Test func theDemoClientAndTheRealClientAreTheSameProtocol() throws {
        let real: any FardeskService = FardeskAPI(baseURL: try #require(URL(string: "http://100.64.0.9:4780")), token: nil)
        let demo = try service(try world(), "Studio")
        #expect(type(of: real) != type(of: demo), "two implementations behind one protocol")
    }

    @Test func demoSessionsShowUserColoursAndDistinctAutomaticColoursPerMachine() async throws {
        let world = try world()
        var userColoured = 0
        for machine in world.machines {
            let sessions = try await service(world, machine.name).sessions()
            let automatic = sessions.compactMap(\.autoColor)
            #expect(automatic.count == sessions.count, "every demo session carries its automatic colour")
            #expect(Set(automatic).count == automatic.count, "automatic colours are distinct on one machine")
            userColoured += sessions.filter { $0.label.color != nil }.count
        }
        #expect(userColoured >= 2, "a reviewer sees both a user colour and automatic colours")
    }

    @Test func threeMachinesWithFakeNamesAndAddressesOnly() throws {
        let world = try world()
        #expect(world.machines.map(\.name) == ["Studio", "Laptop", "Build server"])
        for machine in world.machines {
            #expect(machine.url.host()?.hasSuffix(".invalid") == true, "an address that cannot exist: \(machine.url)")
        }
    }

    @Test func everyFixtureValueIsInventedAndTheRowsAreFresh() async throws {
        let now = Date()
        let world = try world(clock: { now })
        var total = 0
        for machine in world.machines {
            let service = try world.service(for: machine.id)
            for session in try await service.sessions() {
                total += 1
                #expect(session.cwd.hasPrefix("/Users/dev/code/"), "invented folder: \(session.cwd)")
                #expect(session.updatedAt <= now && now.timeIntervalSince(session.updatedAt) < 4 * 3600, "relative to the moment the demo opens")
                #expect(session.pid == nil)
            }
            let hello = try world.hello(for: machine.id)
            guard case .hello(let info, let sessions) = hello else { Issue.record("not a hello"); continue }
            #expect(info.hostname.hasSuffix(".invalid") && info.sessionsCount == sessions.count)
        }
        #expect(total == 9)
    }

    @Test func oneQuestionAndOnePermissionAreWaiting() async throws {
        let world = try world()
        let question = try await waiting(try service(world, "Build server"), .question)
        let permission = try await waiting(try service(world, "Laptop"), .permission)
        for session in [question, permission] {
            #expect(session.status == .waiting)
            let page = try await (try service(world, session.cwd.hasSuffix("api-gateway") ? "Build server" : "Laptop")).activity(sessionID: session.id, before: nil, limit: nil)
            #expect(page.items.last.map { if case .question = $0 { true } else if case .permission = $0 { true } else { false } } == true)
        }
    }

    @Test func pagingGivesTheNewestRowsAndTheCursorToTheOlderOnes() async throws {
        let world = try world()
        let studio = try service(world, "Studio")
        let id = try #require(try await studio.sessions().first { $0.cwd.hasSuffix("weather-dashboard") }).id
        let newest = try await studio.activity(sessionID: id, before: nil, limit: 3)
        #expect(newest.items.count == 3)
        let cursor = try #require(newest.nextBefore)
        let older = try await studio.activity(sessionID: id, before: cursor, limit: 3)
        #expect(older.items.count == 3 && !older.items.contains { $0.id == cursor })
        await #expect(throws: FardeskAPIError.self) { _ = try await studio.activity(sessionID: id, before: "nope", limit: 3) }
    }

    @Test func toolRowsHaveDetailsAndTheDetailOfAnUnknownRowIsNotFound() async throws {
        let world = try world()
        let studio = try service(world, "Studio")
        let id = try #require(try await studio.sessions().first { $0.cwd.hasSuffix("weather-dashboard") }).id
        let rows = try await studio.activity(sessionID: id, before: nil, limit: 100).items
        let tool = try #require(rows.compactMap { row -> ToolActivity? in if case .tool(let tool) = row, tool.hasDetail { tool } else { nil } }.first)
        let detail = try await studio.detail(sessionID: id, activityID: tool.id)
        #expect(detail.activityId == tool.id && !detail.sections.isEmpty)
        await #expect(throws: FardeskAPIError.self) { _ = try await studio.detail(sessionID: id, activityID: "nope") }
    }

    @Test func aMessageShowsAtOnceThenThePretendClaudeAnswersAndNothingIsSent() async throws {
        let world = try world()
        let studio = try service(world, "Studio")
        let id = try #require(try await studio.sessions().first { $0.status == .idle }).id
        let before = try await studio.activity(sessionID: id, before: nil, limit: 200).items.count
        let result = try await studio.message(sessionID: id, text: "Hello demo", attachments: nil)
        #expect(!result.isQueued)
        _ = await nextEvent(world) { if case .session(let s) = $0 { s.id == id && s.status == .idle } else { false } }
        let rows = try await studio.activity(sessionID: id, before: nil, limit: 200).items
        #expect(rows.count == before + 2)
        guard case .user(let user) = rows[rows.count - 2], case .assistant(let reply) = rows[rows.count - 1] else {
            Issue.record("expected the user's line and one canned reply"); return
        }
        #expect(user.text == "Hello demo" && reply.text.contains("demo"))
    }

    @Test func approvingAPermissionAndAnsweringAQuestionChangeTheRowsOnce() async throws {
        let world = try world()
        let laptop = try service(world, "Laptop")
        let session = try await waiting(laptop, .permission)
        let request = try #require(try await laptop.activity(sessionID: session.id, before: nil, limit: 200).items.last.flatMap { row -> PermissionActivity? in if case .permission(let p) = row { p } else { nil } })
        try await laptop.decide(sessionID: session.id, requestID: request.requestId, decision: .allow)
        let after = try await laptop.activity(sessionID: session.id, before: nil, limit: 200).items
        let decided = try #require(after.compactMap { row -> PermissionActivity? in if case .permission(let p) = row { p } else { nil } }.last)
        #expect(decided.state == .allowed)
        await #expect(throws: FardeskAPIError.self) { try await laptop.decide(sessionID: session.id, requestID: request.requestId, decision: .deny) }

        let server = try service(world, "Build server")
        let asking = try await waiting(server, .question)
        let question = try #require(try await server.activity(sessionID: asking.id, before: nil, limit: 200).items.last.flatMap { row -> QuestionActivity? in if case .question(let q) = row { q } else { nil } })
        try await server.answer(sessionID: asking.id, requestID: question.requestId, option: question.options[0])
        let answered = try await server.activity(sessionID: asking.id, before: nil, limit: 200).items.compactMap { row -> QuestionActivity? in if case .question(let q) = row { q } else { nil } }.last
        #expect(answered?.state == .answered)
    }

    @Test func aNewSessionAppearsOnItsMachineOnly() async throws {
        let world = try world()
        let laptop = try service(world, "Laptop")
        let request = NewSessionRequest(cwd: "/Users/dev/code/marketing-site", prompt: "Add a footer", worktree: false, model: nil)
        let started = try await laptop.newSession(request)
        let sessions = try await laptop.sessions()
        let created = try #require(sessions.first { $0.id == started.sessionId })
        #expect(created.cwd == "/Users/dev/code/marketing-site" && created.title == "Add a footer")
        #expect(try await service(world, "Studio").sessions().contains { $0.id == started.sessionId } == false)
    }

    @Test func labelMuteStopAndEndKeepTheirChanges() async throws {
        let world = try world()
        let studio = try service(world, "Studio")
        let id = try #require(try await studio.sessions().first { $0.status == .working }).id
        try await studio.label(sessionID: id, .rename("Renamed"))
        try await studio.label(sessionID: id, .pin(true))
        try await studio.mute(sessionID: id, muted: true)
        var session = try #require(try await studio.sessions().first { $0.id == id })
        #expect(session.label.name == "Renamed" && session.label.pinned && session.muted)
        try await studio.stop(sessionID: id)
        session = try #require(try await studio.sessions().first { $0.id == id })
        #expect(session.status == .idle)
        _ = try await studio.kill(sessionID: id, closeTab: false)
        session = try #require(try await studio.sessions().first { $0.id == id })
        #expect(session.status == .ended && session.replyMode == .resume)
        await #expect(throws: FardeskAPIError.self) { _ = try await studio.message(sessionID: id, text: "x", attachments: nil) }
    }

    @Test func thePictureOfTheMarketingSessionIsServedAndOtherPathsAreNot() async throws {
        let world = try world()
        let laptop = try service(world, "Laptop")
        let id = try #require(try await laptop.sessions().first { $0.cwd.hasSuffix("marketing-site") }).id
        let bytes = try await laptop.attachment(sessionID: id, path: "/tmp/fardesk-demo/laptop/code/marketing-site/.fardesk/attachments/hero.png")
        #expect(bytes.prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), "a PNG")
        await #expect(throws: FardeskAPIError.self) { _ = try await laptop.attachment(sessionID: id, path: "/etc/passwd") }
    }

    @Test func pausingNotificationsIsRememberedAndResumeClearsIt() async throws {
        let now = Date()
        let world = try world(clock: { now })
        let studio = try service(world, "Studio")
        #expect(try await studio.notifications().pausedUntil == nil)
        let paused = try await studio.pauseNotifications(minutes: 60)
        #expect(paused.pausedUntil == now.addingTimeInterval(3600))
        #expect(try await studio.pauseNotifications(minutes: 0).pausedUntil == nil)
    }

    @Test func aSessionOfAnotherMachineIsNotFound() async throws {
        let world = try world()
        let studioID = try #require(try await service(world, "Studio").sessions().first).id
        await #expect(throws: FardeskAPIError.self) { _ = try await service(world, "Laptop").activity(sessionID: studioID, before: nil, limit: nil) }
    }
}
