import FardeskModels
import Foundation
import Testing

struct SessionLabelTests {
    private func encoded(_ request: LabelRequest) throws -> String {
        String(decoding: try FardeskJSON.makeEncoder().encode(request), as: UTF8.self)
    }

    @Test func labelRequestsSendOnlyTheChangedKey() throws {
        #expect(try encoded(.pin(true)) == #"{"pinned":true}"#)
        #expect(try encoded(.color(.teal)) == #"{"color":"teal"}"#)
        #expect(try encoded(.color(nil)) == #"{"color":null}"#)
        #expect(try encoded(.rename("Release")) == #"{"name":"Release"}"#)
        #expect(try encoded(.rename(nil)) == #"{"name":null}"#)
    }

    @Test func typedNamesAreTrimmedCappedAndEmptyMeansNone() {
        #expect(SessionLabelName.normalised("  Release work \n", title: "fardesk") == "Release work")
        #expect(SessionLabelName.normalised("   ", title: "fardesk") == nil)
        #expect(SessionLabelName.normalised("fardesk", title: "fardesk") == nil)
        #expect(SessionLabelName.normalised(String(repeating: "x", count: 200), title: nil)?.count == SessionLabelName.maxLength)
    }

    @Test func labelColoursNeverUseTheStatusColours() {
        let status: Set<String> = ["red", "grey", "gray", "orange", "green"]
        #expect(LabelColor.allCases.allSatisfy { !status.contains($0.rawValue) })
    }

    @Test func aSessionWithoutLabelDecodesAsNoLabelAndALabelRoundTrips() throws {
        let fixture = #"""
        {"id":"s1","title":"Docs cleanup","cwd":"/Users/dev/crawler","status":"idle","waitingFor":null,"owned":false,
         "replyMode":"resume","canStop":false,"summary":"","model":null,"pid":null,"muted":true,"permissionMode":null,
         "contextTokens":null,"cacheExpiresAt":null,"startedAt":"2026-11-13T16:20:00.000Z","updatedAt":"2026-11-13T17:02:10.000Z"}
        """#
        let plain = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(fixture.utf8))
        #expect(plain.label == .none)
        #expect(plain.displayTitle == plain.title)
        let labelled = fixture.replacingOccurrences(
            of: #""muted":"#, with: #""label":{"name":"Mine","color":"pink","pinned":true},"muted":"#)
        let decoded = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(labelled.utf8))
        #expect(decoded.label == SessionLabel(name: "Mine", color: .pink, pinned: true))
        #expect(decoded.displayTitle == "Mine")
        let again = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: try FardeskJSON.makeEncoder().encode(decoded))
        #expect(again == decoded)
    }
}
