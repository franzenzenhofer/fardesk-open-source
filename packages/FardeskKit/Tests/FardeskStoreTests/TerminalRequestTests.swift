import FardeskModels
import FardeskStore
import Foundation
import Testing

/// A request that timed out stays in the session as "waiting at the computer", with what it asks, and is answered from
/// the phone only when the daemon says it can type into that terminal.
struct TerminalRequestTests {
    private func activity(_ json: String) throws -> Activity {
        try FardeskJSON.makeDecoder().decode(Activity.self, from: Data(json.utf8))
    }

    private func question(typable: String, state: String = "terminal") throws -> Activity {
        try activity("""
        {"kind":"question","id":"req-q1","ts":"2026-11-21T16:29:42.000Z","requestId":"q1","text":"Tea or coffee?",
         "options":["Tea","Coffee"],"state":"\(state)"\(typable)}
        """)
    }

    private func permission(typable: String) throws -> Activity {
        try activity("""
        {"kind":"permission","id":"req-p1","ts":"2026-11-21T16:30:00.000Z","requestId":"p1","tool":"Bash",
         "title":"Allow command?","summary":"touch a.txt","cwd":"/work","destructive":false,"state":"terminal"\(typable)}
        """)
    }

    @Test func aHandedOffQuestionKeepsItsTextAndOptionsOutOfTheRowsAndOutOfTheApprovalCards() throws {
        var feed = SessionFeed()
        feed.upsert(try question(typable: ",\"typable\":true"))
        #expect(feed.terminalRequests.count == 1)
        #expect(feed.pendingRequests.isEmpty)
        #expect(feed.rows.isEmpty)
        let shown = try #require(TerminalRequestPresentation(feed.terminalRequests[0]))
        #expect(shown.text == "Tea or coffee?")
        #expect(shown.options == ["Tea", "Coffee"])
        #expect(TerminalRequestPresentation.title == "Waiting at the computer")
    }

    @Test func aTypableQuestionOffersItsOptionsAsButtons() throws {
        let shown = try #require(TerminalRequestPresentation(try question(typable: ",\"typable\":true")))
        #expect(shown.choices == [.option("Tea"), .option("Coffee")])
        #expect(shown.footnote == nil)
    }

    @Test func aQuestionTheDaemonCannotTypeOffersNoButtonsAndSaysWhereToAnswer() throws {
        for typable in ["", ",\"typable\":false"] {
            let shown = try #require(TerminalRequestPresentation(try question(typable: typable)))
            #expect(shown.choices.isEmpty)
            #expect(shown.footnote == "Answer at the computer")
            #expect(shown.options == ["Tea", "Coffee"])
        }
    }

    @Test func aPermissionNamesToolAndInputAndOffersAllowAndDenyOnlyWhenTypable() throws {
        let typable = try #require(TerminalRequestPresentation(try permission(typable: ",\"typable\":true")))
        #expect(typable.text == "Bash: touch a.txt")
        #expect(typable.choices == [.deny, .allow])
        let plain = try #require(TerminalRequestPresentation(try permission(typable: "")))
        #expect(plain.choices.isEmpty)
        #expect(plain.footnote == "Answer at the computer")
    }

    @Test func nothingElseIsATerminalRequest() throws {
        let expired = try question(typable: "", state: "expired")
        #expect(TerminalRequestPresentation(expired) == nil)
        #expect(!expired.isTerminalRequest)
        var feed = SessionFeed()
        feed.upsert(try question(typable: ",\"typable\":true"))
        feed.upsert(try question(typable: "", state: "expired"))
        #expect(feed.terminalRequests.isEmpty)
    }
}
