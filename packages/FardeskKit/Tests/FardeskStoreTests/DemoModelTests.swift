import FardeskDemo
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Demo mode through the real model: every screen's data and every action, on pretend machines, with no network.
@MainActor
struct DemoModelTests {
    private func demoModel() throws -> AppModel {
        AppModel.makeDemo(world: try DemoWorld(replyDelay: .milliseconds(20)))
    }

    private func eventually(_ what: String, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !condition() {
            guard Date() < deadline else { throw DemoTestError.timeout(what) }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    private func session(_ model: AppModel, endingWith folder: String) throws -> (ref: SessionRef, summary: SessionSummary) {
        for machine in model.state.machines {
            if let found = machine.sessions.first(where: { $0.cwd.hasSuffix(folder) }) {
                return (SessionRef(machineID: machine.id, sessionID: found.id), found)
            }
        }
        throw DemoTestError.timeout("no session \(folder)")
    }

    @Test func startingTheDemoShowsAllMachinesAndSessionsWithoutAnyLogin() async throws {
        let model = try demoModel()
        defer { model.endDemo() }
        await model.start()
        #expect(model.isDemo && model.phase == .ready)
        #expect(model.state.machines.map(\.endpoint.name) == ["Build server", "Laptop", "Studio"], "alphabetical, the list default")
        #expect(model.state.machines.allSatisfy { $0.isOnline }, "online without any network")
        #expect(model.state.machines.map(\.sessions.count).reduce(0, +) == 9)
        #expect(model.machines.endpoints.allSatisfy { $0.url.host()?.hasSuffix(".invalid") == true })
        #expect(Set(model.needsYou.map(\.session.id)).count == 3, "the question, the permission and the plan need the user")
    }

    @Test func openingASessionShowsItsRowsAndATapOnReplyAnswersInTheFeed() async throws {
        let model = try demoModel()
        defer { model.endDemo() }
        await model.start()
        let (ref, _) = try session(model, endingWith: "invoice-parser")
        await model.openSession(ref)
        let before = model.feeds.feed(for: ref).activities.count
        #expect(before > 3)
        let sent = await model.send("Please add a changelog line", to: ref)
        #expect(sent)
        try await eventually("the pretend reply") { model.feeds.feed(for: ref).activities.count >= before + 2 }
        let last = try #require(model.feeds.feed(for: ref).activities.last)
        guard case .assistant(let reply) = last else { Issue.record("expected the canned reply"); return }
        #expect(reply.text.contains("demo"))
    }

    @Test func approvingAPermissionAndAnsweringAQuestionClearTheNeedsYouList() async throws {
        let model = try demoModel()
        defer { model.endDemo() }
        await model.start()
        for folder in ["marketing-site", "api-gateway", "recipe-app"] {
            let (ref, _) = try session(model, endingWith: folder)
            await model.openSession(ref)
            let request = try #require(model.feeds.feed(for: ref).pendingRequests.last)
            switch request {
            case .permission(let permission): let done = await model.decide(.allow, requestID: permission.requestId, in: ref); #expect(done)
            case .question(let question): let done = await model.answer(question.options[0], requestID: question.requestId, in: ref); #expect(done)
            default: Issue.record("not a request")
            }
        }
        try await eventually("nothing needs the user any more") { model.needsYou.isEmpty }
    }

    @Test func aNewSessionStartsOnTheChosenMachine() async throws {
        let model = try demoModel()
        defer { model.endDemo() }
        await model.start()
        let laptop = try #require(model.state.machines.first { $0.endpoint.name == "Laptop" })
        let before = laptop.sessions.count
        let request = NewSessionRequest(cwd: "/Users/dev/code/marketing-site", prompt: "Add a footer", worktree: false, model: nil)
        let started = await model.newSession(request, on: laptop.id)
        #expect(started != nil)
        try await eventually("the session in the list") { model.state.machines.first { $0.id == laptop.id }?.sessions.count == before + 1 }
    }

    @Test func leavingTheDemoDeletesItsScratchFolderAndTheRealModelNeverSawIt() async throws {
        let model = try demoModel()
        await model.start()
        let scratch = try #require(model.demoScratch)
        model.endDemo()
        #expect(!FileManager.default.fileExists(atPath: scratch.path))
        try await StoreSandbox.with { sandbox in
            let real = AppModel(configuration: sandbox.configuration())
            await real.start()
            #expect(!real.isDemo && real.needsOnboarding, "a clean real model is still on the first screen")
        }
    }
}

private enum DemoTestError: Error { case timeout(String) }
