import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

struct BootstrapMachinesTests {
    @Test func parsesNamesAndUrls() {
        let peers = BootstrapMachines.parse("Mac|http://100.1.1.1:4780; Linux |https://box.example:4780")
        #expect(peers.map(\.name) == ["Mac", "Linux"])
        #expect(peers.map(\.url.absoluteString) == ["http://100.1.1.1:4780", "https://box.example:4780"])
    }

    @Test(arguments: ["", "NoUrl", "|http://a:1", "Name|ftp://a:1", "Name|notaurl", "A|http://a:1|extra"])
    func skipsBrokenEntries(text: String) {
        #expect(BootstrapMachines.parse(text).isEmpty)
    }
}

struct PushActionTests {
    private let base = ["machine": "Mac", "sessionId": "s1"]
    private let target = PushTarget(machine: "Mac", sessionID: "s1", requestID: nil)
    private let request = PushTarget(machine: "Mac", sessionID: "s1", requestID: "r1")

    private func parse(_ identifier: String, _ info: [String: String], text: String? = nil) -> PushAction? {
        PushAction.parse(actionIdentifier: identifier, userInfo: info, text: text)
    }

    @Test func tapOpensTheSession() {
        #expect(parse(PushAction.defaultActionIdentifier, base) == .open(target))
        #expect(parse(PushAction.openIdentifier, base) == .open(target))
    }

    @Test func allowAndDenyNeedARequest() {
        let info = base.merging(["requestId": "r1"]) { $1 }
        #expect(parse(PushAction.allowIdentifier, info) == .decide(.allow, request))
        #expect(parse(PushAction.denyIdentifier, info) == .decide(.deny, request))
        #expect(parse(PushAction.allowIdentifier, base) == nil)
        #expect(parse(PushAction.denyIdentifier, base) == nil)
    }

    @Test func replyIsAnAnswerForQuestionsAndAMessageOtherwise() {
        let info = base.merging(["requestId": "r1"]) { $1 }
        #expect(parse(PushAction.replyIdentifier, info, text: "yes") == .answer("yes", request))
        #expect(parse(PushAction.replyIdentifier, base, text: "go on") == .reply("go on", target))
        #expect(parse(PushAction.replyIdentifier, base, text: "") == nil)
        #expect(parse(PushAction.replyIdentifier, base) == nil)
    }

    @Test func wipeCommandBeatsEverythingElse() {
        #expect(parse("", ["command": "wipe"]) == .wipe)
        #expect(parse(PushAction.openIdentifier, base.merging(["command": "wipe"]) { $1 }) == .wipe)
    }

    @Test func unknownOrIncompletePayloadsAreIgnored() {
        #expect(parse("SOMETHING", base) == nil)
        #expect(parse(PushAction.openIdentifier, ["machine": "Mac"]) == nil)
        #expect(parse(PushAction.openIdentifier, [:]) == nil)
    }
}

@MainActor
struct PushHandlingTests {
    @Test func openResolvesTheMachineByNameAndUnknownMachinesAreIgnored() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let known = PushTarget(machine: "box", sessionID: "s1", requestID: nil)
                let opened = await model.handle(.open(known))
                #expect(opened == SessionRef(machineID: endpoint.id, sessionID: "s1"))
                let unknown = PushTarget(machine: "nope", sessionID: "s1", requestID: "r")
                #expect(await model.handle(.open(unknown)) == nil)
                #expect(await model.handle(.decide(.allow, unknown)) == nil)
                #expect(await model.handle(.answer("x", unknown)) == nil)
                #expect(await model.handle(.reply("x", unknown)) == nil)
                model.stop()
            }
        }
    }

    @Test func wipeLogsOutAndForgetsTokens() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                await model.handle(.wipe)
                #expect(model.phase == .loggedOut)
                #expect(try sandbox.keychainTokens.load(endpoint.id) == nil)
            }
        }
    }

    @Test func pairingByLinkStoresTheTokenAndGoesReady() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let model = AppModel(configuration: sandbox.configuration())
                await model.start()
                let json = #"{"v":1,"name":"paired","url":"\#(daemon.url.absoluteString)","token":"\#(TestDaemon.token)"}"#
                await model.pair(link: "fardesk://pair?d=" + Base64URL.encode(Data(json.utf8)))
                #expect(model.phase == .ready)
                #expect(model.machines.endpoints.map(\.name) == ["paired"])
                let id = try #require(model.machines.endpoints.first?.id)
                #expect(try sandbox.keychainTokens.load(id) == TestDaemon.token)
                model.stop()
            }
        }
    }

    @Test func removingAMachineForgetsItsTokenAndListEntry() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                model.removeMachine(id: endpoint.id)
                #expect(model.machines.endpoints.isEmpty)
                #expect(try sandbox.keychainTokens.load(endpoint.id) == nil)
                #expect(try sandbox.machinesFile.load().endpoints.isEmpty)
                model.stop()
            }
        }
    }

    @Test func aBrokenLinkShowsAnErrorAndStaysLoggedOut() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            await model.pair(link: "not a link")
            #expect(model.phase == .loggedOut)
            #expect(model.loginError != nil)
        }
    }
}
