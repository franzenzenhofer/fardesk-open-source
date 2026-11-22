import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Claude Code's own dialogs (feature `claude-dialogs`): decoding, wording and the answer route. The app decides nothing.
@MainActor
struct DialogTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func dialog(kind: String = "cold_resume_quota", choices: [String], payload: String, extra: String = "") throws -> DialogActivity {
        let json = #"""
        {"kind":"dialog","id":"d1","ts":"2027-01-15T08:00:00.000Z","requestId":"r1","dialogKind":"\#(kind)",
         "choices":[\#(choices.map { "\"\($0)\"" }.joined(separator: ","))],"payload":\#(payload)\#(extra)}
        """#
        let activity = try FardeskJSON.makeDecoder().decode(Activity.self, from: Data(json.utf8))
        guard case .dialog(let found) = activity else { throw DialogTestError.notADialog }
        return found
    }

    private enum DialogTestError: Error { case notADialog }

    private var coldPayload: String {
        let since = Int((now.timeIntervalSince1970 - 3 * 3_600) * 1_000)
        return #"{"inactiveSince":\#(since),"contextTokens":426000,"percentOfFiveHourLimit":12.4,"trigger":"send","focusedAction":"resume","offersLookUp":true,"offersSummary":true}"#
    }

    @Test func aDialogDecodesWithUnknownFieldsAndUnknownPayloadShapes() throws {
        let known = try dialog(choices: ["resume", "dismiss"], payload: coldPayload, extra: #","somethingNew":{"a":[1,2,null]}"#)
        #expect(known.requestId == "r1" && known.choices == ["resume", "dismiss"] && known.isPending)
        #expect(known.payload["contextTokens"]?.number == 426_000)
        let odd = try dialog(kind: "future_kind", choices: ["dismiss"], payload: #"[1,"two",{"three":3}]"#)
        #expect(odd.payload.isEmpty, "a payload that is no object never fails the list")
        let nested = try dialog(kind: "future_kind", choices: [], payload: #"{"deep":{"list":[true,null,1.5,"x"]}}"#)
        #expect(nested.payload["deep"] != nil && nested.choices.isEmpty)
    }

    @Test func anOpenDialogIsAPendingRequestAndAnAnsweredOneIsNot() throws {
        let open = try dialog(choices: ["resume"], payload: coldPayload)
        #expect(Activity.dialog(open).isPendingRequest)
        let closed = try dialog(choices: ["resume"], payload: coldPayload, extra: #","state":"answered""#)
        #expect(!Activity.dialog(closed).isPendingRequest)
        #expect(FeedBlock.group([.dialog(closed)]).first == .note(id: "d1", symbolName: FardeskSymbol.question, text: "Resume this conversation? (answered)"))
    }

    @Test func theColdResumeDialogSpeaksInClaudeCodesWords() throws {
        let all = ["resume", "new_conversation", "compact", "dismiss"]
        let shown = DialogPresentation(try dialog(choices: all, payload: coldPayload), now: now)
        #expect(shown.title == "Resume this conversation?")
        #expect(shown.text == "This conversation has been inactive for 3 h and is 426k tokens long. Resuming it will use about 12% of your 5-hour usage limit.")
        #expect(shown.buttons.map(\.title) == ["Resume", "Start a new conversation", "Resume from summary", "Not now"])
        #expect(shown.buttons.map(\.answer) == all)
        #expect(shown.buttons.filter(\.isFocused).map(\.answer) == ["resume"])
    }

    @Test func sizesAndDurationsUseTheShortLabels() {
        #expect([950, 426_000, 1_200_000].map(UsageLabels.tokens) == ["950", "426k", "1.2M"])
        let labels = [60, 3 * 3_600, 2 * 86_400].map { UsageLabels.idle(since: now.addingTimeInterval(-Double($0)), now: now) }
        #expect(labels == ["1 min", "3 h", "2 d"])
    }

    @Test func aDialogKindThisVersionDoesNotKnowOffersOnlyNotNow() throws {
        let shown = DialogPresentation(try dialog(kind: "future_kind", choices: ["yes", "dismiss"], payload: "{}"), now: now)
        #expect(shown.text == "Claude Code asks something this app version cannot show. Answer at the computer or update the app.")
        #expect(shown.buttons.map(\.title) == ["Not now"] && shown.buttons.map(\.answer) == ["dismiss"])
        let stuck = DialogPresentation(try dialog(kind: "future_kind", choices: ["yes"], payload: "{}"), now: now)
        #expect(stuck.buttons.isEmpty)
    }

    @Test func aWaitingSessionForADialogNeedsYouAndLoadsTheCard() throws {
        let session = try Fixtures.session("working", overriding: ["status": "waiting", "waitingFor": "dialog"])
        #expect(session.waitingFor == .dialog && session.waitingFor?.phoneCanAnswer == true)
        #expect(AttentionCard.resolve(session: session, feedShowsRequest: false) == .loadingRequest("Loading what Claude Code asks..."))
        #expect(AttentionCard.resolve(session: session, feedShowsRequest: true) == nil)
        #expect(SessionPresentation(session: session, now: now).statusLabel == "Needs your answer")
    }

    func withModel(_ body: (AppModel, LocalHTTPServer, SessionRef) async throws -> Void) async throws {
        let server = try LocalHTTPServer { _ in LocalHTTPResponse(body: Data(#"{"ok":true}"#.utf8)) }
        try await server.start()
        defer { server.stop() }
        let sandbox = try StoreSandbox()
        let endpoint = MachineEndpoint(name: "Box", url: try #require(URL(string: "http://127.0.0.1:\(server.port)")))
        var list = MachineList()
        list.add(endpoint)
        try sandbox.keychainTokens.save("t0k", endpoint.id)
        try sandbox.machinesFile.save(list)
        let model = AppModel(configuration: sandbox.configuration())
        await model.start()
        model.stop()
        try await body(model, server, SessionRef(machineID: endpoint.id, sessionID: "s1"))
    }

    @Test func theModelSendsTheChosenAnswerToTheDialogRoute() async throws {
        try await withModel { model, server, ref in
            #expect(await model.answerDialog(ref, requestID: "r1", answer: "new_conversation"))
            let sent = try #require(server.requests.first { $0.path.contains("/dialog/") }, "the answer went to the dialog route")
            #expect(sent.method == "POST" && sent.path == "/v1/sessions/s1/dialog/r1")
            #expect(String(decoding: sent.body, as: UTF8.self) == #"{"answer":"new_conversation"}"#)
        }
    }

    @Test func sendingToALongIdleSessionHoldsNothingBack() async throws {
        try await withModel { model, server, ref in
            #expect(await model.submit(OutgoingMessage(text: "go on"), to: ref) == .sent)
            let arrived = try await waitUntil { server.requests.contains { $0.path == "/v1/sessions/s1/message" } }
            #expect(arrived, "the message went to the machine at once")
        }
    }
}
