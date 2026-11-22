import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct FeedCacheTests {
    private func activities() throws -> [Activity] { try Fixtures.activities() }

    @Test func aFeedSurvivesTheDiskWithItsCursor() throws {
        let sandbox = try StoreSandbox()
        let machineID = UUID()
        let page = try Fixtures.page(items: try activities(), nextBefore: "older-cursor")
        let feed = SessionFeed(page: page)
        try sandbox.cache.saveFeed(feed.snapshot(), machineID: machineID, sessionID: "session/with:odd chars")
        let loaded = try #require(sandbox.cache.loadFeed(machineID: machineID, sessionID: "session/with:odd chars"))
        #expect(SessionFeed(snapshot: loaded) == feed)
        #expect(loaded.nextBefore == "older-cursor")
        #expect(sandbox.cache.loadFeed(machineID: machineID, sessionID: "other") == nil)
        try sandbox.cache.removeAll()
        #expect(sandbox.cache.loadFeed(machineID: machineID, sessionID: "session/with:odd chars") == nil)
    }

    @Test func aSnapshotKeepsOnlyTheNewestRowsAndAnOlderCursor() throws {
        let rows = try activities()
        try #require(rows.count > 3)
        let feed = SessionFeed(page: try Fixtures.page(items: rows, nextBefore: nil))
        let snapshot = feed.snapshot(limit: 3)
        #expect(snapshot.activities.map(\.id) == feed.activities.suffix(3).map(\.id))
        #expect(snapshot.nextBefore == snapshot.activities.first?.id)
        #expect(feed.snapshot().activities.count == rows.count)
        #expect(FeedSnapshot.cachedRows == 200)
    }

    @Test func refreshingMergesAnOverlappingPageAndReplacesAStaleOne() throws {
        let rows = try activities()
        try #require(rows.count > 4)
        var feed = SessionFeed(page: try Fixtures.page(items: Array(rows.prefix(rows.count - 1)), nextBefore: "cursor"))
        feed.refresh(with: try Fixtures.page(items: Array(rows.suffix(3)), nextBefore: "later"))
        // The daemon lists every open request on the newest page; a cached one it no longer lists was answered.
        let listed = Set(rows.suffix(3).map(\.id))
        let expected = rows.filter { !($0.isPendingRequest || $0.isTerminalRequest) || listed.contains($0.id) }
        #expect(feed.activities.map(\.id) == expected.map(\.id), "overlap: cached rows stay, the new row is added in order")
        #expect(feed.nextBefore == "cursor", "the cached cursor still points at older rows")

        var stale = SessionFeed(page: try Fixtures.page(items: Array(rows.prefix(2)), nextBefore: "c"))
        stale.refresh(with: try Fixtures.page(items: Array(rows.suffix(2)), nextBefore: "fresh"))
        #expect(stale.activities.map(\.id) == rows.suffix(2).map(\.id), "no overlap: the old rows would leave a gap")
        #expect(stale.nextBefore == "fresh")
    }

    @Test func hubAndDirectMachinesShareOneStatusText() throws {
        let now = Date()
        let seen = now.addingTimeInterval(-300)
        let info = HubMachine(name: "Mac mini Pro", online: false, lastSeen: seen, problem: "Tailscale is stopped", sessions: 3, waiting: 1, working: 1)
        let fromHub = MachinePresentation(hub: info, now: now)
        var state = MachineState(endpoint: Fixtures.endpoint("Mac mini Pro"))
        state.apply(hub: info)
        let fromState = MachinePresentation(machine: state, now: now)
        #expect(fromHub == fromState)
        #expect(fromHub.statusLabel == "Offline")
        #expect(fromHub.lastSeenLabel == "Last seen 5m ago")
        #expect(fromHub.problem == "Tailscale is stopped")
        #expect((fromHub.sessions, fromHub.waiting, fromHub.working) == (3, 1, 1))

        let online = MachinePresentation(hub: HubMachine(name: "Linux", online: true, latencyMs: 12), now: now)
        #expect(online.statusLabel == "Online" && online.latencyLabel == "12 ms" && online.problem == nil)
    }

    @Test func pauseTextsAreWorkedOutFromTheClock() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let nine = Date(timeIntervalSince1970: 1_799_971_200 + 9 * 3_600)
        #expect(PausePresentation.minutes(untilHour: 8, now: nine, calendar: calendar) == 23 * 60)
        let seven = nine.addingTimeInterval(-2 * 3_600)
        #expect(PausePresentation.minutes(untilHour: 8, now: seven, calendar: calendar) == 60)
        #expect(PausePresentation.label(pausedUntil: nine.addingTimeInterval(1_800), now: nine, calendar: calendar) == "Paused until 09:30")
        #expect(PausePresentation.label(pausedUntil: nine.addingTimeInterval(-1), now: nine, calendar: calendar) == nil)
        #expect(PausePresentation.label(pausedUntil: nil, now: nine, calendar: calendar) == nil)
    }

    @Test func theClearCommandIsRecognisedOnlyWhenItIsAllThatWasTyped() {
        #expect(OutgoingMessage(text: "/clear").isClearCommand)
        #expect(OutgoingMessage(text: "  /clear\n").isClearCommand)
        #expect(!OutgoingMessage(text: "/clear now").isClearCommand)
        #expect(!OutgoingMessage(text: "please /clear").isClearCommand)
    }
}
