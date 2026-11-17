import FardeskModels
import FardeskStore
import Foundation
import Testing

@Suite struct SpokenTextTests {
    @Test func removesCodeBlocksTablesAndEmphasis() {
        let markdown = "# Title\nRun **this** now.\n```swift\nlet x = 1\n```\n| a | b |\n|---|---|\n| 1 | 2 |\nDone `ok`."
        #expect(SpokenText.from(markdown: markdown) == "Title\nRun this now.\nDone ok.")
    }

    @Test func linksKeepTheirTextAndBareUrlsGo() {
        #expect(SpokenText.from(markdown: "See [the docs](https://x.dev/a) at https://x.dev now") == "See the docs at  now")
    }

    @Test func listMarkersAndQuotesAreDropped() {
        #expect(SpokenText.from(markdown: "- one\n* two\n1. three\n> quoted") == "one\ntwo\nthree\nquoted")
    }

    @Test func onlyCodeLeavesNothing() {
        #expect(SpokenText.from(markdown: "```\nls\n```").isEmpty)
    }

    @Test func blankLinesCollapse() {
        #expect(SpokenText.from(markdown: "a\n\n\n\nb") == "a\n\nb")
    }
}

@Suite struct VoiceRepliesTests {
    private let since = Date(timeIntervalSince1970: 1_000)

    private func row(_ kind: String, id: String, offset: Double, text: String = "Hello") throws -> Activity {
        let stamp = Date(timeIntervalSince1970: 1_000 + offset).formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true))
        let json = #"{"kind":"\#(kind)","id":"\#(id)","ts":"\#(stamp)Z","text":"\#(text)"}"#
        return try FardeskJSON.makeDecoder().decode(Activity.self, from: Data(json.utf8))
    }

    @Test func speaksOnlyNewAssistantText() throws {
        let rows = [
            try row("assistant", id: "old", offset: -5),
            try row("user", id: "me", offset: 1),
            try row("system", id: "sys", offset: 2),
            try row("assistant", id: "new", offset: 3, text: "**Hi**"),
        ]
        #expect(VoiceReplies.toSpeak(in: rows, since: since, spoken: []) == [SpokenReply(id: "new", text: "Hi")])
    }

    @Test func skipsSpokenAndEmptyReplies() throws {
        let rows = [
            try row("assistant", id: "a", offset: 1),
            try row("assistant", id: "b", offset: 2, text: "```\\ncode\\n```"),
        ]
        #expect(VoiceReplies.toSpeak(in: rows, since: since, spoken: ["a"]).isEmpty)
    }

    @Test func listensOnlyWhenHandsFreeSilentAndIdle() {
        #expect(VoiceReplies.shouldListen(handsFree: true, isSpeaking: false, status: .idle))
        #expect(!VoiceReplies.shouldListen(handsFree: false, isSpeaking: false, status: .idle))
        #expect(!VoiceReplies.shouldListen(handsFree: true, isSpeaking: true, status: .idle))
        #expect(!VoiceReplies.shouldListen(handsFree: true, isSpeaking: false, status: .working))
    }
}
