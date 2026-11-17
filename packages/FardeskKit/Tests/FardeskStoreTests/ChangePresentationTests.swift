import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

private let now = Date(timeIntervalSince1970: 1_800_000_000)

private func section(_ title: String) -> [String: any Sendable] {
    ["title": title, "subtitle": "Edited", "added": 1, "removed": 0, "lines": [[String: any Sendable]]()]
}

struct ChangePresentationTests {
    @Test func sectionSplitsPathIntoNameAndFolder() throws {
        let detail = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        let first = try #require(detail.sections.first)
        #expect(first.fileName == "PaintEngine.swift")
        #expect(first.folderLabel == "Sources")
    }

    @Test func sectionWithoutFolderFallsBackToSubtitle() throws {
        let detail = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "output")
        let first = try #require(detail.sections.first)
        #expect(first.fileName == "swift test")
        #expect(first.folderLabel == "exit 0")
    }

    @Test func footerNamesTheVerbAndTheAge() throws {
        let diff = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        let output = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "output")
        #expect(diff.footerLabel(activityTime: now, now: now) == "Edited just now")
        #expect(output.footerLabel(activityTime: now.addingTimeInterval(-120), now: now) == "Ran 2m ago")
    }

    @Test func nextChangeIsTheNextFileOfTheSameActivity() throws {
        let detail = try Fixtures.decode(
            ActivityDetail.self, "ActivityDetail", "diff",
            overriding: ["sections": [section("Sources/A.swift"), section("Sources/B.swift")]]
        )
        let next = NextChange.after(section: 0, of: detail, in: [])
        #expect(next == NextChange(name: "B.swift", activityID: detail.activityId, section: 1))
    }

    @Test func nextChangeIsTheNextEditInTheFeed() throws {
        let detail = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        let later = try Fixtures.decode(
            Activity.self, "Activity", "toolOk",
            overriding: ["id": "act_9", "tool": "Edit", "title": "Edited Brush.swift"]
        )
        let activities = try Fixtures.activities() + [later]
        let next = NextChange.after(section: 0, of: detail, in: activities)
        #expect(next == NextChange(name: "Brush.swift", activityID: "act_9", section: 0))
    }

    @Test func nextChangeSkipsRowsThatAreNotChanges() throws {
        let detail = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        let files = try Fixtures.decode(
            Activity.self, "Activity", "files", overriding: ["id": "act_10", "title": "Changed 2 files"]
        )
        let activities = try Fixtures.activities() + [files]
        #expect(NextChange.after(section: 0, of: detail, in: activities)?.name == "Changed 2 files")
    }

    @Test func noNextChangeAtTheEndOrForAnUnknownActivity() throws {
        let detail = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        #expect(NextChange.after(section: 0, of: detail, in: try Fixtures.activities()) == nil)
        #expect(NextChange.after(section: 0, of: detail, in: []) == nil)
    }

    @Test func pushIsSilentOnlyForTheSessionBeingViewed() {
        let open = PushTarget(machine: "Mac", sessionID: "s1", requestID: nil)
        let request = PushTarget(machine: "Mac", sessionID: "s1", requestID: "r1")
        let other = PushTarget(machine: "Mac", sessionID: "s2", requestID: nil)
        let elsewhere = PushTarget(machine: "Linux", sessionID: "s1", requestID: nil)
        #expect(!PushPresentation.shouldPresent(target: request, viewing: open))
        #expect(PushPresentation.shouldPresent(target: other, viewing: open))
        #expect(PushPresentation.shouldPresent(target: elsewhere, viewing: open))
        #expect(PushPresentation.shouldPresent(target: request, viewing: nil))
        #expect(PushPresentation.shouldPresent(target: nil, viewing: open))
    }

    @Test func headerParts() throws {
        let presentation = SessionPresentation(session: try Fixtures.session("working"), now: now)
        #expect(presentation.headerLeadParts(machineName: "Mac") == ["Mac", presentation.folderLabel])
    }
}
