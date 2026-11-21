import FardeskFixtures
import FardeskModels
import FardeskStore
import Testing

struct SessionFeedTests {
    @Test func emptyFeedHasNothingToPage() {
        let feed = SessionFeed()
        #expect(feed.oldestID == nil)
        #expect(!feed.canLoadMore)
        #expect(feed.activities.isEmpty)
    }

    @Test func pageSetsCursorAndOldestId() throws {
        let feed = SessionFeed(page: try Fixtures.page("withNextPage"))
        #expect(feed.canLoadMore)
        #expect(feed.nextBefore != nil)
        #expect(feed.oldestID == feed.activities.first?.id)
        let last = SessionFeed(page: try Fixtures.page("lastPageEmpty"))
        #expect(!last.canLoadMore)
        #expect(last.oldestID == nil)
    }

    @Test func prependAddsOlderRowsAndDedupesById() throws {
        let all = try Fixtures.activities()
        let newer = try Fixtures.page(items: Array(all[8...]), nextBefore: "act_0008")
        let older = try Fixtures.page(items: Array(all[...9]), nextBefore: nil)
        var feed = SessionFeed(page: newer)
        let newerCount = feed.activities.count
        feed.prepend(page: older)
        #expect(feed.activities.map(\.id) == all.map(\.id))
        #expect(feed.activities.count == all.count)
        #expect(newerCount < all.count)
        #expect(!feed.canLoadMore)
        feed.prepend(page: older)
        #expect(feed.activities.count == all.count)
    }

    @Test func pendingRequestsAreOldestFirstAndLeaveTheRows() throws {
        let feed = SessionFeed(page: try Fixtures.page("everyActivityKind"))
        let pending = feed.pendingRequests
        #expect(pending.map(\.id) == ["act_0007", "act_0010"])
        #expect(feed.rows.count == feed.activities.count - 2 - feed.terminalRequests.count)
        #expect(feed.rows.allSatisfy { !$0.isPendingRequest })
    }

    @Test func timestampAndPendingFlagCoverEveryKind() throws {
        let kinds = try Fixtures.activities()
        #expect(Set(kinds.map(\.timestamp)).count == kinds.count)
        let flags = kinds.map(\.isPendingRequest)
        #expect(flags.filter { $0 }.count == 2)
    }

    @Test(arguments: ["permissionAllowed", "permissionExpired", "questionAnswered", "questionExpired", "toolOk"])
    func resolvedRequestsAreNotPending(name: String) throws {
        #expect(try !Fixtures.activity(name).isPendingRequest)
    }
}
