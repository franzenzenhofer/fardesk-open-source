import FardeskFixtures
import FardeskModels
import FardeskTestDaemon
@testable import FardeskStore
import Foundation
import Observation
import Testing

private let base = Date(timeIntervalSince1970: 1_800_000_000)

private func user(_ id: String, at seconds: Double, text: String = "hi") throws -> Activity {
    let ts = FardeskJSON.makeEncoderDate(base.addingTimeInterval(seconds))
    return try Fixtures.decode(Activity.self, "Activity", "user", overriding: ["id": id, "ts": ts, "text": text])
}

private final class Fired: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.withLock { count } }
    func bump() { lock.withLock { count += 1 } }
}

struct SessionFeedBatchTests {
    @Test func anIdenticalRowChangesNothing() throws {
        var feed = SessionFeed()
        let row = try user("a", at: 1)
        let first = feed.upsert(row)
        let again = feed.upsert(row)
        let edited = feed.upsert(try user("a", at: 1, text: "edited"))
        #expect(first && !again && edited, "the same row again is a no-op")
    }

    @Test func aPageOfUnchangedRowsLeavesTheFeedUntouched() throws {
        let rows = try (0..<50).map { try user("r\($0)", at: Double($0)) }
        var feed = SessionFeed(snapshot: FeedSnapshot(activities: rows, nextBefore: nil))
        let before = feed
        let page = try Fixtures.page(items: Array(rows.suffix(20)), nextBefore: nil)
        let changed = feed.refresh(with: page)
        #expect(!changed)
        #expect(feed == before && feed.blocks == before.blocks)
    }

    @Test func refreshMergesAPageAndRebuildsTheDerivedDataOnce() throws {
        let rows = try (0..<10).map { try user("r\($0)", at: Double($0)) }
        var feed = SessionFeed(snapshot: FeedSnapshot(activities: Array(rows.prefix(8)), nextBefore: nil))
        let page = try Fixtures.page(items: Array(rows.suffix(5)), nextBefore: nil)
        let changed = feed.refresh(with: page)
        #expect(changed)
        #expect(feed.activities.map(\.id) == rows.map(\.id))
        #expect(feed.rows == feed.activities && feed.blocks == FeedBlock.group(feed.rows))
    }

    @Test func derivedRowsAndPendingRequestsFollowTheActivities() throws {
        let feed = SessionFeed(page: try Fixtures.page("everyActivityKind"))
        #expect(feed.rows == feed.activities.filter { !$0.isPendingRequest && !$0.isTerminalRequest })
        #expect(feed.terminalRequests == feed.activities.filter(\.isTerminalRequest))
        #expect(feed.pendingRequests == feed.activities.filter(\.isPendingRequest))
        #expect(feed.blocks == FeedBlock.group(feed.rows))
    }
}

@MainActor
struct ListIsolationTests {

    @Test func fiftyActivityRowsOfOneSessionDoNotTouchWhatTheListReads() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, endpoint) = try await sandbox.startedModelWithSessions()
            let ref = SessionRef(machineID: endpoint.id, sessionID: "sess_7f3a91")
            let fired = Fired()
            withObservationTracking {
                _ = model.state
                _ = model.needsYou
                _ = model.onlineMachines
                _ = model.pausedUntil
                _ = model.connectivityBanner
            } onChange: { fired.bump() }
            let listBefore = model.state
            for index in 0..<50 { model.apply(.activity(sessionId: ref.sessionID, activity: try user("a\(index)", at: Double(index))), from: endpoint.id) }
            #expect(fired.value == 0, "no observer of the list was woken")
            #expect(model.state == listBefore)
            #expect(model.feeds.feed(for: ref).activities.count == 50)
        }
    }

    @Test func onlyTheBoxOfTheSessionThatChangedIsWoken() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, endpoint) = try await sandbox.startedModelWithSessions()
            let open = SessionRef(machineID: endpoint.id, sessionID: "sess_7f3a91")
            let other = SessionRef(machineID: endpoint.id, sessionID: "sess_2c84be")
            let openFired = Fired()
            let otherFired = Fired()
            withObservationTracking { _ = model.feeds.box(for: open).feed } onChange: { openFired.bump() }
            withObservationTracking { _ = model.feeds.box(for: other).feed } onChange: { otherFired.bump() }
            let row = try user("a", at: 1)
            model.apply(.activity(sessionId: open.sessionID, activity: row), from: endpoint.id)
            #expect(openFired.value == 1 && otherFired.value == 0)
            let again = Fired()
            withObservationTracking { _ = model.feeds.box(for: open).feed } onChange: { again.bump() }
            model.apply(.activity(sessionId: open.sessionID, activity: row), from: endpoint.id)
            #expect(again.value == 0, "an identical row wakes nobody")
        }
    }

    @Test func anUnchangedMachineGoingOfflineAgainDoesNotTouchTheState() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, endpoint) = try await sandbox.startedModelWithSessions()
            model.markOffline(endpoint.id)
            let fired = Fired()
            withObservationTracking { _ = model.state } onChange: { fired.bump() }
            model.markOffline(endpoint.id)
            #expect(fired.value == 0)
        }
    }
}

struct ExtensionWriterFeedTests {
    @Test func theNewestToolTitleOfThePinnedFeedReachesTheLiveActivityAndOthersAreIgnored() async throws {
        let endpoint = Fixtures.endpoint("Linux")
        var state = AppState(endpoints: [endpoint])
        try state.apply(try Fixtures.event("helloWithSessions"), from: endpoint.id)
        let pinned = SessionRef(machineID: endpoint.id, sessionID: "sess_7f3a91")
        let seen = LockedTitles()
        let writer = ExtensionWriter(store: nil, delay: .milliseconds(50), onLiveActivity: { seen.add($0?.lastToolTitle) })
        await writer.setPinned(pinned)
        await writer.submit(state)
        #expect(try await waitUntil { seen.values.count == 1 })
        let tool = try #require(try Fixtures.activities().first { if case .tool = $0 { true } else { false } })
        await writer.submit(feed: SessionFeed(snapshot: FeedSnapshot(activities: [tool], nextBefore: nil)), of: pinned)
        #expect(try await waitUntil { seen.values.count == 2 })
        let ignored = SessionRef(machineID: endpoint.id, sessionID: "sess_2c84be")
        await writer.submit(feed: SessionFeed(snapshot: FeedSnapshot(activities: [tool], nextBefore: nil)), of: ignored)
        try await Task.sleep(for: .milliseconds(400))
        #expect(seen.values.count == 2, "one write for the state, one for the pinned feed, none for another session")
        #expect(seen.values.last == tool.titleForTest)
    }
}

private final class LockedTitles: @unchecked Sendable {
    private let lock = NSLock()
    private var all: [String?] = []
    var values: [String?] { lock.withLock { all } }
    func add(_ title: String?) { lock.withLock { all.append(title) } }
}

private extension Activity {
    var titleForTest: String? {
        if case .tool(let tool) = self { tool.title } else { nil }
    }
}
