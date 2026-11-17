import FardeskModels
import Foundation
import Testing

@testable import FardeskStore

@Suite("Attached files in a user message")
struct AttachedFilesTests {
    @Test func plainTextHasNoFiles() {
        let parts = AttachedFiles(parsing: "Please look at this\nand tell me")
        #expect(parts.words == "Please look at this\nand tell me")
        #expect(parts.files.isEmpty)
    }

    @Test func splitsWordsFromTrailingLinesInOrder() {
        let text = "look at this\nAttached image: /w/.fardesk/attachments/20261117T101112123Z-shot.png\nAttached audio: /w/a.m4a\nAttached file: /w/My Report.pdf"
        let parts = AttachedFiles(parsing: text)
        #expect(parts.words == "look at this")
        #expect(parts.files.map(\.kind) == [.image, .audio, .file])
        #expect(parts.files.map(\.path) == ["/w/.fardesk/attachments/20261117T101112123Z-shot.png", "/w/a.m4a", "/w/My Report.pdf"])
    }

    @Test func displayNameDropsTheTimeStampOnly() {
        #expect(AttachedFile(kind: .image, path: "/w/20261117T101112123Z-shot-2.png").displayName == "shot-2.png")
        #expect(AttachedFile(kind: .file, path: "/w/plain-name.pdf").displayName == "plain-name.pdf")
    }

    @Test func aLineInTheMiddleStaysInTheWords() {
        let text = "Attached image: /a.png\nand then more words"
        let parts = AttachedFiles(parsing: text)
        #expect(parts.words == text)
        #expect(parts.files.isEmpty)
    }

    @Test func rejectsUnknownKindsAndRelativePaths() {
        #expect(AttachedFiles(parsing: "hi\nAttached video: /a.mov").files.isEmpty)
        #expect(AttachedFiles(parsing: "hi\nAttached image: a.png").files.isEmpty)
    }

    @Test func onlyAttachedLinesLeaveEmptyWords() {
        let parts = AttachedFiles(parsing: "Attached image: /a.png")
        #expect(parts.words.isEmpty)
        #expect(parts.files.count == 1)
    }

    @Test func userBlocksShowOnlyTheWords() throws {
        let json = #"{"id":"u1","ts":"2026-11-17T10:00:00.000Z","text":"see\nAttached image: /a.png"}"#
        let user = try FardeskJSON.makeDecoder().decode(UserActivity.self, from: Data(json.utf8))
        let blocks = FeedBlock.group([.user(user)])
        #expect(blocks == [.user(id: "u1", text: "see", files: [AttachedFile(kind: .image, path: "/a.png")])])
    }
}
