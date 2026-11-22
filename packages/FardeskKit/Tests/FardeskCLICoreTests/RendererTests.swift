import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

enum Samples {
    static let now: Date = {
        let text = Data("\"2026-11-14T09:13:03.000Z\"".utf8)
        return try! FardeskJSON.makeDecoder().decode(Date.self, from: text)
    }()
    static let utc = TimeZone(identifier: "UTC")!
    static var human: RenderOptions { RenderOptions(now: now, format: .human, timeZone: utc) }
    static var json: RenderOptions { RenderOptions(now: now, format: .json, timeZone: utc) }

    static func studio() throws -> MachineState {
        var state = MachineState(endpoint: Fixtures.endpoint("Studio Mac"))
        state.apply(try Fixtures.event("helloWithSessions"))
        return state
    }

    static func offlineLinux() throws -> MachineState {
        var state = MachineState(endpoint: Fixtures.endpoint("Linux", host: "100.64.0.2"))
        state.apply(try Fixtures.event("helloEmpty"))
        state.apply(.ping(ts: now.addingTimeInterval(-300)))
        state.markOffline(now: now)
        return state
    }

    static func connecting() -> MachineState {
        MachineState(endpoint: Fixtures.endpoint("Fresh", host: "100.64.0.3"))
    }

    static func jsonObjects(_ text: String) throws -> [Any] {
        try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any] ?? []
    }
}

struct LoggedOutAndQueuedRendererTests {
    private func loggedOut() -> MachineState {
        var state = MachineState(endpoint: Fixtures.endpoint("Revoked", host: "100.64.0.4"))
        state.markFailed(by: MachineAccessError.notLoggedIn(machine: "Revoked"), now: Samples.now)
        return state
    }

    @Test func aLoggedOutMachineIsNotCalledOffline() throws {
        #expect(try SessionsRenderer.render([loggedOut()], options: Samples.human).hasPrefix("Revoked  Logged out"))
        #expect(try MachinesRenderer.render([loggedOut()], options: Samples.human).contains("logged out"))
    }

    @Test func aQueuedReplySaysClaudeIsBusy() throws {
        #expect(try ActionRenderer.render(.queued, options: Samples.human) == "Queued: Claude is busy, it will read this after the current turn")
        #expect(try ActionRenderer.render(.queued, options: Samples.json) == #"{"ok":true,"queued":true}"#)
        #expect(try ActionRenderer.render(.sent, options: Samples.json) == #"{"ok":true}"#)
    }
}

struct MachinesAndSessionsRendererTests {
    @Test func machinesTable() throws {
        let machines = [try Samples.studio(), try Samples.offlineLinux(), Samples.connecting()]
        let text = try MachinesRenderer.render(machines, options: Samples.human)
        #expect(text == """
        NAME        STATUS      SESSIONS  VERSION  GHOSTTY
        Studio Mac  online      11        0.1.0    ok
        Linux       offline     0         0.1.0    unknown
        Fresh       connecting  0         -        -
        """)
    }

    @Test func machinesTableWithoutMachines() throws {
        #expect(try MachinesRenderer.render([], options: Samples.human) == "No machines paired")
        #expect(try SessionsRenderer.render([], options: Samples.human) == "No machines paired")
    }

    @Test func machinesJsonIsTheContractMachineArray() throws {
        let studio = try Samples.studio()
        let text = try MachinesRenderer.render([studio, Samples.connecting()], options: Samples.json)
        let expected = try Fixtures.decode(StreamEvent.self, "StreamEvent", "helloWithSessions")
        guard case .hello(let machine, _) = expected else { Issue.record("not hello"); return }
        let encoded = try FardeskJSON.makeEncoder().encode([machine])
        #expect(text == String(decoding: encoded, as: UTF8.self))
    }

    @Test func sessionsAreGroupedPerMachineInMockupOrder() throws {
        let machines = [try Samples.studio(), try Samples.offlineLinux(), Samples.connecting()]
        let text = try SessionsRenderer.render(machines, options: Samples.human)
        #expect(text == """
        Studio Mac  Online
          !  Back after a break      Needs your answer                                       Now  sess_91d
          !  Crawler retry logic     Needs your approval                                     2m   sess_2c8
          !  Export dialog           Needs your answer                                       8m   sess_91d
          ~  Smear brush engine      Working - Edited PaintEngine.swift                      1m   sess_7f3
          -  Codex: fix the crawler  Your turn - Finished the retry rewrite                  2h   sess_cod
          -  Idle terminal session   Your turn - Finished the retry rewrite                  2h   sess_3a1
          -  Idle terminal session   Your turn - Finished the retry rewrite                  2h   sess_5d9
          -  Idle terminal session   Your turn - Finished the retry rewrite                  2h   sess_8e4
          ~  Idle terminal session   In background - Started the test run in the background  2h   sess_bg0
          -  Docs cleanup            Your turn - Looked through 6 files                      16h  sess_e55
          x  Release notes           Stopped                                                 1d   sess_0b6

        Linux  Offline - last seen 5m ago
          (no sessions)

        Fresh  Connecting
          (no sessions)
        """)
    }

    @Test func offlineHeaderVariants() throws {
        var recent = MachineState(endpoint: Fixtures.endpoint("Recent"))
        recent.apply(.ping(ts: Samples.now.addingTimeInterval(-3)))
        recent.markOffline(now: Samples.now)
        var never = MachineState(endpoint: Fixtures.endpoint("Never", host: "100.64.0.9"))
        never.markOffline(now: Samples.now)
        let text = try SessionsRenderer.render([recent, never], options: Samples.human)
        #expect(text.hasPrefix("Recent  Offline - last seen just now\n"))
        #expect(text.contains("\n\nNever  Offline\n"))
    }

    @Test func sessionsJsonCarriesMachineNameAndContractSession() throws {
        let text = try SessionsRenderer.render([try Samples.studio()], options: Samples.json)
        let items = try Samples.jsonObjects(text)
        #expect(items.count == 11)
        let objects = items.compactMap { $0 as? [String: Any] }
        let first = try #require(objects.first { ($0["session"] as? [String: Any])?["id"] as? String == "sess_2c84be" })
        #expect(first["machine"] as? String == "Studio Mac")
        let session = try #require(first["session"] as? [String: Any])
        #expect(session["id"] as? String == "sess_2c84be")
        let fixture = try JSONSerialization.jsonObject(with: Fixtures.data("SessionSummary", "waitingPermission"))
        #expect((session as NSDictionary).isEqual(fixture))
    }
}

struct FeedRendererTests {
    @Test func everyKindGetsOneLine() throws {
        let text = try FeedRenderer.render(try Fixtures.activities(), options: Samples.human)
        #expect(text == """
        09:00:05 > Make the brush smear softer.
        09:00:20 < I will adjust the blend falloff in PaintEngine.swift.
        09:00:30 $ Running swift test (running)
        09:01:10 $ Ran swift test - 31 passed (ok)
        09:02:00 $ Failed to edit PaintEngine.swift (error)
        09:03:00 ~ Edited PaintEngine.swift
        09:04:00 ? Which export format should I use? [PNG | JPEG] [pending req_a1]
        09:04:30 ? Describe the brush name. [answered]
        09:05:30 ? Pick a colour space. [sRGB | Display P3] [expired]
        09:06:00 ! Run swift test - swift test --parallel [pending req_b1]
        09:06:30 ! Edit PaintEngine.swift [allowed]
        09:07:00 ! Remove build folder - rm -rf .build DESTRUCTIVE [denied]
        09:08:00 ! Run crawler tests - npm test [expired]
        09:09:00 # Session resumed
        09:10:00 ? Which export format should I use? [PNG | JPEG] [terminal]
        09:10:30 ? Which export format should I use? [PNG | JPEG] [terminal]
        09:11:00 ! Run swift test - swift test --parallel [terminal]
        09:11:30 ! Run swift test - swift test --parallel [terminal]
        09:12:00 ? Resume this conversation? [resume | new_conversation | compact | dismiss] [pending req_d1]
        09:13:00 ? Resume this conversation? [resume | new_conversation | dismiss] [answered]
        09:14:00 ? Resume this conversation? [resume | new_conversation | dismiss] [expired]
        10:00:00 ! Ready to code? - Soften the brush smear [pending req_p1]
        10:05:00 ! Ready to code? - Soften the brush smear [pending req_p2]
        10:10:00 ! Ready to code? - Soften the brush smear [allowed]
        10:15:00 ! Ready to code? - Soften the brush smear [denied]
        """)
    }

    @Test func timesFollowTheGivenTimeZone() throws {
        let user = try Fixtures.activity("user")
        let vienna = RenderOptions(
            now: Samples.now, format: .human, timeZone: TimeZone(identifier: "Europe/Vienna")!
        )
        #expect(FeedRenderer.line(user, options: vienna).hasPrefix("10:00:"))
        #expect(FeedRenderer.line(user, options: Samples.human).hasPrefix("09:00:"))
    }

    @Test func multilineTextCollapsesToOneLine() throws {
        let user = try Fixtures.decode(
            Activity.self, "Activity", "user", overriding: ["text": "first\n\n  second\tthird"]
        )
        #expect(FeedRenderer.line(user, options: Samples.human).hasSuffix("> first second third"))
    }

    @Test func jsonPrintsOneContractObjectPerLine() throws {
        let activities = try Fixtures.activities()
        let text = try FeedRenderer.render(activities, options: Samples.json)
        let lines = text.split(separator: "\n")
        #expect(lines.count == activities.count)
        let original = try Fixtures.data("ActivityPage", "everyActivityKind")
        let page = try #require(try JSONSerialization.jsonObject(with: original) as? [String: Any])
        let items = try #require(page["items"] as? [Any])
        for (line, item) in zip(lines, items) {
            let parsed = try JSONSerialization.jsonObject(with: Data(line.utf8))
            #expect((parsed as AnyObject).isEqual(item))
        }
    }

    @Test func emptyFeedRendersNothing() throws {
        #expect(try FeedRenderer.render([], options: Samples.human) == "")
        #expect(try FeedRenderer.render([], options: Samples.json) == "")
    }
}

struct DetailRendererTests {
    private func detail(_ name: String) throws -> ActivityDetail {
        try Fixtures.decode(ActivityDetail.self, "ActivityDetail", name)
    }

    @Test func diffShowsLineNumbersSignsAndCounts() throws {
        let text = try DetailRenderer.render(try detail("diff"), options: Samples.human)
        #expect(text == """
        Sources/PaintEngine.swift - Edited  +2 -1
        41   func blend(_ a: Color, _ b: Color) -> Color {
        42 -     return a.mix(b, 0.5)
        42 +     let falloff = smoothstep(0, 1, strength)
        43 +     return a.mix(b, falloff)

        """)
    }

    @Test func truncatedDiffWithoutSubtitle() throws {
        let text = try DetailRenderer.render(try detail("diffTruncated"), options: Samples.human)
        #expect(text == """
        Tests/PaintEngineTests.swift  +120 -0
        1 + import Testing

        (truncated)
        """)
    }

    @Test func outputShowsPlainLinesWithoutCounts() throws {
        let text = try DetailRenderer.render(try detail("output"), options: Samples.human)
        #expect(text == """
        swift test - exit 0
        Test Suite 'All tests' started
        Executed 31 tests, with 0 failures
        """)
    }

    @Test func noSectionsSaysSo() throws {
        let text = try DetailRenderer.render(try detail("outputNoSections"), options: Samples.human)
        #expect(text == "(no output)")
    }

    @Test(arguments: ["diff", "diffTruncated", "output", "outputNoSections"])
    func jsonIsTheContractDocument(name: String) throws {
        let text = try DetailRenderer.render(try detail(name), options: Samples.json)
        let parsed = try JSONSerialization.jsonObject(with: Data(text.utf8))
        let original = try JSONSerialization.jsonObject(with: Fixtures.data("ActivityDetail", name))
        #expect((parsed as AnyObject).isEqual(original))
        #expect(!text.contains("\n"))
    }
}

struct SmallRendererTests {
    @Test func foldersAlignPathsAndShowRelativeTime() throws {
        let folders = try Fixtures.decode(RecentFolders.self, "RecentFolders", "two")
        let text = try FoldersRenderer.render(folders, options: Samples.human)
        #expect(text == "/Users/dev/smear-studio  1m\n/Users/dev/crawler       16h")
        let none = try Fixtures.decode(RecentFolders.self, "RecentFolders", "none")
        #expect(try FoldersRenderer.render(none, options: Samples.human) == "No recent folders")
    }

    @Test func foldersJsonIsTheContractDocument() throws {
        let folders = try Fixtures.decode(RecentFolders.self, "RecentFolders", "two")
        let text = try FoldersRenderer.render(folders, options: Samples.json)
        let original = try JSONSerialization.jsonObject(with: Fixtures.data("RecentFolders", "two"))
        #expect((try JSONSerialization.jsonObject(with: Data(text.utf8)) as AnyObject).isEqual(original))
    }

    @Test func pairingConfirmationShowsNameAndUrlOnly() throws {
        let endpoint = Fixtures.endpoint("Linux")
        let human = try PairingRenderer.render(endpoint, options: Samples.human)
        #expect(human == "Paired Linux at http://100.64.0.10:7878")
        let json = try PairingRenderer.render(endpoint, options: Samples.json)
        #expect(json == "{\"id\":\"\(endpoint.id.uuidString)\",\"name\":\"Linux\",\"url\":\"http://100.64.0.10:7878\"}")
    }

    @Test(arguments: [
        ("conflict", "error: Permission already decided (conflict)"),
        ("notFound", "error: No such session (not_found)"),
    ])
    func errorsReadAsOneLine(name: String, expected: String) throws {
        let response = try Fixtures.decode(ErrorResponse.self, "ErrorResponse", name)
        #expect(try ErrorRenderer.render(response, options: Samples.human) == expected)
        let json = try ErrorRenderer.render(response, options: Samples.json)
        let original = try JSONSerialization.jsonObject(with: Fixtures.data("ErrorResponse", name))
        #expect((try JSONSerialization.jsonObject(with: Data(json.utf8)) as AnyObject).isEqual(original))
    }

    @Test func renderOptionsDefaultToTheCurrentTimeZone() {
        #expect(RenderOptions(now: Samples.now, format: .human).timeZone == .current)
    }
}

struct ShortIDTests {
    private func entries() throws -> [ShortID.Entry] {
        let names = ["working", "waitingPermission", "waitingQuestion", "idleResume", "endedTakeover"]
        return try names.map { (machine: "Mac", session: try Fixtures.session($0)) }
    }

    @Test func shortIdIsTheFirstEightCharacters() {
        #expect(ShortID.short("sess_7f3a91") == "sess_7f3")
        #expect(ShortID.short("abc") == "abc")
    }

    @Test func uniquePrefixResolves() throws {
        let found = try ShortID.resolve("sess_7f", in: try entries())
        #expect(found.session.id == "sess_7f3a91")
        #expect(found.machine == "Mac")
        #expect(try ShortID.resolve("SESS_E55", in: try entries()).session.id == "sess_e5517c")
    }

    @Test func exactTitleResolves() throws {
        let found = try ShortID.resolve("export dialog", in: try entries())
        #expect(found.session.id == "sess_91d0aa")
    }

    @Test func ambiguousPrefixListsCandidates() throws {
        let error = try #require(throws: ShortIDError.self) { try ShortID.resolve("sess_", in: try entries()) }
        guard case .ambiguous(let query, let candidates) = error else { Issue.record("wrong case"); return }
        #expect(query == "sess_")
        #expect(candidates.count == 5)
        #expect(candidates.first == "Mac/sess_7f3 Smear brush engine")
        #expect(error.errorDescription?.hasPrefix("\"sess_\" matches several sessions: Mac/sess_7f3") == true)
    }

    @Test func ambiguousTitlesListCandidates() throws {
        let twins = [
            (machine: "A", session: try Fixtures.session("working", overriding: ["title": "Same"])),
            (machine: "B", session: try Fixtures.session("idleResume", overriding: ["title": "same"])),
        ]
        #expect(throws: ShortIDError.ambiguous(
            query: "SAME", candidates: ["A/sess_7f3 Same", "B/sess_e55 same"]
        )) { try ShortID.resolve("SAME", in: twins) }
    }

    @Test func titleBeatsAnAmbiguousIdPrefix() throws {
        let both = [
            (machine: "A", session: try Fixtures.session("working", overriding: ["id": "dup_1", "title": "dup"])),
            (machine: "A", session: try Fixtures.session("idleResume", overriding: ["id": "dup_2", "title": "other"])),
        ]
        #expect(try ShortID.resolve("dup", in: both).session.id == "dup_1")
    }

    @Test func unknownQueryIsNotFound() throws {
        #expect(throws: ShortIDError.notFound(query: "zzz")) { try ShortID.resolve("zzz", in: try entries()) }
        #expect(ShortIDError.notFound(query: "zzz").errorDescription == "No session matches \"zzz\"")
        #expect(throws: ShortIDError.notFound(query: "")) { try ShortID.resolve("", in: try entries()) }
    }
}
