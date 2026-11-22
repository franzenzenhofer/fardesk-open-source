import FardeskModels
import Foundation
import Testing

struct SessionLabelTests {
    private func encoded(_ request: LabelRequest) throws -> String {
        String(decoding: try FardeskJSON.makeEncoder().encode(request), as: UTF8.self)
    }

    @Test func labelRequestsSendOnlyTheChangedKey() throws {
        #expect(try encoded(.pin(true)) == #"{"pinned":true}"#)
        #expect(try encoded(.color(LabelColor(hex: "#0B9371"))) == ##"{"color":"#0B9371"}"##)
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

    @Test func theUsersColourAlwaysWinsAndTheAutomaticOneShowsOnlyWhileTheSwitchIsOn() throws {
        let fixture = #"""
        {"id":"s1","title":"Docs cleanup","cwd":"/Users/dev/crawler","status":"idle","waitingFor":null,"owned":false,
         "replyMode":"resume","canStop":false,"summary":"","model":null,"pid":null,"agent":"claude","background":0,"home":null,"muted":false,"label":{"name":null,"color":null,"pinned":false},
         "autoColor":"#0B9371","permissionMode":null,"contextTokens":null,"cacheExpiresAt":null,
         "startedAt":"2026-11-13T16:20:00.000Z","updatedAt":"2026-11-13T17:02:10.000Z"}
        """#
        let automatic = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(fixture.utf8))
        #expect(automatic.autoColor?.hex == "#0B9371")
        #expect(automatic.shownColor(automatic: true)?.hex == "#0B9371")
        #expect(automatic.shownColor(automatic: false) == nil)
        let picked = fixture.replacingOccurrences(of: #""color":null"#, with: ##""color":"#1A2B3C""##)
        let own = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(picked.utf8))
        #expect(own.shownColor(automatic: true)?.hex == "#1A2B3C")
        #expect(own.shownColor(automatic: false)?.hex == "#1A2B3C")
        let again = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: try FardeskJSON.makeEncoder().encode(own))
        #expect(again == own)
        let old = picked.replacingOccurrences(of: ##""color":"#1A2B3C""##, with: #""color":"teal""#)
        #expect(throws: DecodingError.self) { try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(old.utf8)) }
    }

    @Test func aSessionWithoutTheAutoColorKeyFailsToDecode() throws {
        let fixture = #"""
        {"id":"s1","title":"Docs cleanup","cwd":"/Users/dev/crawler","status":"idle","waitingFor":null,"owned":false,
         "replyMode":"resume","canStop":false,"summary":"","model":null,"pid":null,"agent":"claude","background":0,"home":null,"muted":false,
         "label":{"name":null,"color":null,"pinned":false},"permissionMode":null,"contextTokens":null,"cacheExpiresAt":null,
         "startedAt":"2026-11-13T16:20:00.000Z","updatedAt":"2026-11-13T17:02:10.000Z"}
        """#
        #expect(throws: DecodingError.self) { try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(fixture.utf8)) }
        let withNull = fixture.replacingOccurrences(of: #""muted":false,"#, with: #""muted":false,"autoColor":null,"#)
        #expect(try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(withNull.utf8)).autoColor == nil)
    }

    @Test func aSessionWithoutLabelDecodesAsNoLabelAndALabelRoundTrips() throws {
        let fixture = #"""
        {"id":"s1","title":"Docs cleanup","cwd":"/Users/dev/crawler","status":"idle","waitingFor":null,"owned":false,
         "replyMode":"resume","canStop":false,"summary":"","model":null,"pid":null,"agent":"claude","background":0,"home":null,"muted":true,"autoColor":null,"permissionMode":null,
         "contextTokens":null,"cacheExpiresAt":null,"startedAt":"2026-11-13T16:20:00.000Z","updatedAt":"2026-11-13T17:02:10.000Z"}
        """#
        let plain = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(fixture.utf8))
        #expect(plain.label == .none)
        #expect(plain.displayTitle == plain.title)
        let labelled = fixture.replacingOccurrences(
            of: #""muted":"#, with: ##""label":{"name":"Mine","color":"#F965B5","pinned":true},"muted":"##)
        let decoded = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: Data(labelled.utf8))
        #expect(decoded.label == SessionLabel(name: "Mine", color: LabelColor(hex: "#F965B5"), pinned: true))
        #expect(decoded.displayTitle == "Mine")
        let again = try FardeskJSON.makeDecoder().decode(SessionSummary.self, from: try FardeskJSON.makeEncoder().encode(decoded))
        #expect(again == decoded)
    }

    @Test func theChatImageHashDecodesWhenPresentAndIsNilWhenNullOrMissingAndRoundTrips() throws {
        let decoder = FardeskJSON.makeDecoder()
        let withImage = try decoder.decode(SessionLabel.self, from: Data(#"{"name":null,"color":null,"pinned":false,"image":"0123456789abcdef"}"#.utf8))
        #expect(withImage.image == "0123456789abcdef")
        let withNull = try decoder.decode(SessionLabel.self, from: Data(#"{"name":null,"color":null,"pinned":false,"image":null}"#.utf8))
        #expect(withNull.image == nil)
        let missing = try decoder.decode(SessionLabel.self, from: Data(#"{"name":null,"color":null,"pinned":false}"#.utf8))
        #expect(missing == .none)
        let again = try decoder.decode(SessionLabel.self, from: try FardeskJSON.makeEncoder().encode(withImage))
        #expect(again == withImage)
        let written = String(decoding: try FardeskJSON.makeEncoder().encode(SessionLabel.none), as: UTF8.self)
        #expect(written.contains(#""image":null"#))
    }
}
