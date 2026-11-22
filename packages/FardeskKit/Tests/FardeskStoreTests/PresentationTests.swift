import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

private let now = Date(timeIntervalSince1970: 1_800_000_000)

private func ago(_ seconds: Double) -> Date { now.addingTimeInterval(-seconds) }

private func isoString(_ date: Date) -> String {
    Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)
}

struct RelativeTimeTests {
    @Test(arguments: [
        (-5.0, "Now"), (0.0, "Now"), (9.9, "Now"), (10.0, "10s"), (12.0, "12s"), (59.9, "59s"),
        (60.0, "1m"), (119.0, "1m"), (120.0, "2m"), (3_599.0, "59m"), (3_600.0, "1h"),
        (86_399.0, "23h"), (86_400.0, "1d"), (259_200.0, "3d"), (8_640_000.0, "100d"),
    ])
    func boundaries(seconds: Double, expected: String) {
        #expect(RelativeTimeFormat.short(from: ago(seconds), to: now) == expected)
    }

    @Test(arguments: [
        ("/Users/dev/smear-studio", "~/smear-studio"),
        ("/home/dev/dev/crawler", "~/dev/crawler"),
        ("/Users/dev", "~"),
        ("/Users/dev/", "~"),
        ("/Users", "/Users"),
        ("/opt/work", "/opt/work"),
        ("relative/Users/dev", "relative/Users/dev"),
        ("Users/x/y", "Users/x/y"),
        ("/", "/"),
    ])
    func folderLabels(cwd: String, expected: String) {
        #expect(FolderLabel.shortened(cwd) == expected)
    }
}

struct SessionPresentationTests {
    private func present(_ name: String, _ overrides: [String: any Sendable] = [:]) throws -> SessionPresentation {
        let session = try Fixtures.session(name, overriding: overrides.merging(["updatedAt": isoString(ago(120))]) { a, _ in a })
        return SessionPresentation(session: session, now: now)
    }

    @Test func waitingForPermission() throws {
        let p = try present("waitingPermission")
        #expect(p.statusLabel == "Needs your approval")
        #expect(p.subtitleParts == ["Needs your approval"])
        #expect(p.symbolName == "exclamationmark.circle.fill")
        #expect(p.relativeTime == "2m")
        #expect(p.folderLabel == "~/crawler")
        #expect(p.composerMode == .composer)
        let id = try Fixtures.session("waitingPermission").id
        #expect(p.terminalCommand == "claude --resume \(id)")
    }

    @Test func waitingForQuestion() throws {
        let p = try present("waitingQuestion")
        #expect(p.statusLabel == "Needs your answer")
        #expect(p.subtitleParts == ["Needs your answer"])
    }

    @Test func waitingWithoutReasonStillSaysItNeedsYou() throws {
        let p = try present("waitingPermission", ["waitingFor": NSNull()])
        #expect(p.statusLabel == "Needs you")
    }

    @Test func workingShowsTheSummary() throws {
        let p = try present("working")
        #expect(p.statusLabel == "Working")
        #expect(p.subtitleParts == ["Working", "Edited PaintEngine.swift"])
        #expect(p.symbolName == "ellipsis.circle.fill")
        let blank = try present("working", ["summary": ""])
        #expect(blank.subtitleParts == ["Working"])
    }

    @Test func idleIsYourTurnWithTheLastLineAndNoPauseSign() throws {
        let p = try present("idleResume")
        #expect(p.statusLabel == "Your turn")
        #expect(p.subtitleParts == ["Your turn", "Looked through 6 files"])
        #expect(p.symbolName == "arrowshape.turn.up.left.circle")
        #expect(p.composerMode == .resume(label: "Resume to reply"))
        #expect(try present("idleResume", ["summary": ""]).subtitleParts == ["Your turn"])
    }

    @Test func aComputerWaitNamesItsDialogOnce() throws {
        let p = try present("waitingPermission", ["waitingFor": "terminal", "summary": "Needs you at the computer: trust prompt"])
        #expect(p.subtitleParts == ["Needs you at the computer", "trust prompt"])
    }

    @Test func endedSaysStoppedAndNothingElse() throws {
        let p = try present("endedTakeover")
        #expect(p.statusLabel == "Stopped")
        #expect(p.subtitleParts == ["Stopped"])
        #expect(p.symbolName == "stop.circle.fill")
        #expect(p.composerMode == .takeover(label: "Take over to reply"))
        #expect(try present("endedTakeover", ["summary": "Done"]).subtitleParts == ["Stopped"], "no 'Can resume', no snippet")
    }
}

struct ActivityPresentationTests {
    private func tool(_ name: String, status: String) throws -> ActivityPresentation {
        let activity = try Fixtures.decode(
            ToolActivity.self, "Activity", "toolOk", overriding: ["tool": name, "status": status, "title": "Ran \(name)"]
        )
        return ActivityPresentation(tool: activity)
    }

    @Test(arguments: [
        ("Edit", "pencil"), ("Write", "pencil"), ("MultiEdit", "pencil"), ("NotebookEdit", "pencil"),
        ("Bash", "terminal"), ("Read", "doc.text.magnifyingglass"),
        ("Grep", "folder"), ("Glob", "folder"), ("LS", "folder"),
        ("WebFetch", "checkmark.circle"),
    ])
    func finishedToolsUseTheirKindSymbol(tool name: String, symbol: String) throws {
        let p = try tool(name, status: "ok")
        #expect(p.symbolName == symbol)
        #expect(!p.isRunning)
    }

    private func bash(title: String, tool name: String = "Bash") throws -> ActivityPresentation {
        let activity = try Fixtures.decode(
            ToolActivity.self, "Activity", "toolOk", overriding: ["tool": name, "status": "ok", "title": title]
        )
        return ActivityPresentation(tool: activity)
    }

    @Test func passedTestRunGetsAGreenCheck() throws {
        let p = try bash(title: "Ran swift test - 31 passed")
        #expect(p.symbolName == "checkmark.circle.fill")
        #expect(p.isSuccess)
    }

    @Test func failedTestRunGetsTheFailureSymbol() throws {
        let p = try bash(title: "Ran npm test - 2 failed")
        #expect(p.symbolName == "xmark.octagon")
        #expect(!p.isSuccess)
    }

    @Test func plainCommandsAndOtherToolsKeepTheirSymbol() throws {
        let plain = try bash(title: "Ran ls")
        #expect(plain.symbolName == "terminal")
        #expect(!plain.isSuccess)
        let other = try bash(title: "Read 3 passed", tool: "Read")
        #expect(other.symbolName == "doc.text.magnifyingglass")
        #expect(!other.isSuccess)
    }

    @Test func statusOverridesTheKindSymbol() throws {
        let running = try tool("Bash", status: "running")
        #expect(running.symbolName == "circle.dotted")
        #expect(running.isRunning)
        let failed = try tool("Edit", status: "error")
        #expect(failed.symbolName == "xmark.octagon")
        #expect(!failed.isRunning)
    }

    @Test func realFixturesMapToTheMockupSymbols() throws {
        let kinds = try Fixtures.activities()
        let symbols = kinds.compactMap { activity -> String? in
            guard case .tool(let tool) = activity else { return nil }
            return ActivityPresentation(tool: tool).symbolName
        }
        #expect(symbols == ["circle.dotted", "checkmark.circle.fill", "xmark.octagon"])
    }
}

struct PermissionPresentationTests {
    private func card(_ name: String, _ overrides: [String: any Sendable] = [:]) throws -> PermissionPresentation {
        let permission = try Fixtures.decode(PermissionActivity.self, "Activity", name, overriding: overrides)
        return PermissionPresentation(permission: permission)
    }

    @Test func commandCardMatchesMockup03() throws {
        let p = try card("permissionPending")
        #expect(p.cardTitle == "Allow command?")
        #expect(p.summary == "swift test --parallel")
        #expect(p.cwdLabel == "~/smear-studio")
        #expect(!p.requiresConfirmation)
    }

    @Test func editAndOtherToolsGetTheirOwnTitles() throws {
        #expect(try card("permissionAllowed").cardTitle == "Allow edit?")
        #expect(try card("permissionPending", ["tool": "Read"]).cardTitle == "Allow Read?")
    }

    @Test func emptySummaryFallsBackToTheTitle() throws {
        let p = try card("permissionAllowed")
        #expect(p.summary == "Edit PaintEngine.swift")
    }

    @Test func destructivePermissionsRequireConfirmation() throws {
        #expect(try card("permissionDeniedDestructive").requiresConfirmation)
    }
}

struct SessionActionTests {
    private func permission(_ name: String) throws -> PermissionActivity {
        try Fixtures.decode(PermissionActivity.self, "Activity", name)
    }

    @Test func killAlwaysNeedsConfirmationStopNever() {
        #expect(SessionAction.kill.requiresConfirmation)
        #expect(!SessionAction.stop.requiresConfirmation)
    }

    @Test func onlyAllowingADestructivePermissionNeedsConfirmation() throws {
        let safe = try permission("permissionPending")
        let risky = try permission("permissionDeniedDestructive")
        #expect(!SessionAction.decide(.allow, on: safe).requiresConfirmation)
        #expect(!SessionAction.decide(.allowAlways, on: safe).requiresConfirmation)
        #expect(SessionAction.decide(.allow, on: risky).requiresConfirmation)
        #expect(SessionAction.decide(.allowAlways, on: risky).requiresConfirmation)
        #expect(!SessionAction.decide(.deny, on: risky).requiresConfirmation)
    }
}

struct SessionOrderingTests {
    private func session(
        _ id: String, _ status: String, title: String = "T", updated: Double = 0
    ) throws -> SessionSummary {
        try Fixtures.session(
            "working",
            overriding: ["id": id, "status": status, "title": title, "updatedAt": isoString(ago(updated))]
        )
    }

    @Test func groupsComeInTheMockupOrder() throws {
        let sessions = [
            try session("e", "ended"), try session("i", "idle"),
            try session("w", "working"), try session("n", "waiting"),
        ]
        #expect(SessionOrdering.sorted(sessions).map(\.id) == ["n", "w", "i", "e"])
    }

    @Test func newestFirstInsideAGroup() throws {
        let sessions = [try session("old", "idle", updated: 500), try session("new", "idle", updated: 5)]
        #expect(SessionOrdering.sorted(sessions).map(\.id) == ["new", "old"])
    }

    @Test func titleThenIdBreakTies() throws {
        let sessions = [
            try session("3", "idle", title: "beta"), try session("2", "idle", title: "Alpha"),
            try session("1", "idle", title: "alpha"),
        ]
        #expect(SessionOrdering.sorted(sessions).map(\.id) == ["1", "2", "3"])
    }

    @Test func fixtureSessionsSortWaitingFirst() throws {
        let names = ["endedTakeover", "idleResume", "working", "waitingQuestion", "waitingPermission"]
        let sessions = try names.map { try Fixtures.session($0) }
        let sorted = SessionOrdering.sorted(sessions).map(\.id)
        #expect(sorted == ["sess_2c84be", "sess_91d0aa", "sess_7f3a91", "sess_e5517c", "sess_0b6e12"])
    }

    @Test func prefixMatchHelperHandlesEmptyAndEquatable() {
        #expect(UniquePrefix.resolve("", in: ["a"]) { $0 } == .none)
        #expect(UniquePrefix.resolve("a", in: ["abc", "abd"]) { $0 } == .ambiguous(["abc", "abd"]))
        #expect(UniquePrefix.resolve("abc", in: ["abc", "abcd"]) { $0 } == .unique("abc"))
    }
}
