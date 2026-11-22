import FardeskModels

/// The activities of one session in chronological order, with paging state for older rows.
/// A feed as the offline cache stores it.
public struct FeedSnapshot: Codable, Equatable, Sendable {
    public static let cachedRows = 200

    public let activities: [Activity]
    public let nextBefore: String?
}

public struct SessionFeed: Equatable, Sendable {
    public private(set) var activities: [Activity] = []
    /// The feed without pending request rows (they are shown in the card instead). Kept up to date when the activities change.
    public private(set) var rows: [Activity] = []
    /// Pending permissions and questions, oldest first: the sticky card shows these.
    public private(set) var pendingRequests: [Activity] = []
    /// Requests handed off to the terminal ("waiting at the computer"), oldest first: shown as a card without Allow/Deny unless typable.
    public private(set) var terminalRequests: [Activity] = []
    /// The feed as the screen draws it (pending requests left out, tool rows grouped), computed when the rows change, not in a view body.
    public private(set) var blocks: [FeedBlock] = []
    /// Cursor for the next older page (`nextBefore` of the last loaded page); nil when everything is loaded.
    public private(set) var nextBefore: String?

    public init() {}

    public init(page: ActivityPage) {
        prepend(page: page)
    }

    public init(snapshot: FeedSnapshot) {
        activities = snapshot.activities
        nextBefore = snapshot.nextBefore
        rebuildDerived()
    }

    public static func == (lhs: SessionFeed, rhs: SessionFeed) -> Bool {
        lhs.nextBefore == rhs.nextBefore && lhs.activities == rhs.activities
    }

    public var oldestID: String? { activities.first?.id }

    public var canLoadMore: Bool { nextBefore != nil }

    /// Replaces the activity with the same id in place, otherwise inserts by timestamp (ties after existing).
    /// False (and nothing done) when the feed already holds exactly this activity.
    @discardableResult
    public mutating func upsert(_ activity: Activity) -> Bool {
        guard upsertWithoutRebuild(activity) else { return false }
        rebuildDerived()
        return true
    }

    /// What survives a restart: the newest rows and the cursor for the ones before them.
    public func snapshot(limit: Int = FeedSnapshot.cachedRows) -> FeedSnapshot {
        guard activities.count > limit else { return FeedSnapshot(activities: activities, nextBefore: nextBefore) }
        let kept = Array(activities.suffix(limit))
        return FeedSnapshot(activities: kept, nextBefore: kept.first?.id)
    }

    /// Folds the newest page into a feed that already shows cached rows: a page that overlaps the
    /// rows is merged in (changed rows replaced, new ones added, the derived data rebuilt once),
    /// anything else replaces them. True when the feed changed.
    @discardableResult
    public mutating func refresh(with page: ActivityPage) -> Bool {
        let known = Set(activities.map(\.id))
        guard page.items.contains(where: { known.contains($0.id) }) else {
            let replaced = SessionFeed(page: page)
            guard replaced != self else { return false }
            self = replaced
            return true
        }
        var changed = dropClosedRequests(listedIn: page)
        for item in page.items where upsertWithoutRebuild(item) { changed = true }
        if changed { rebuildDerived() }
        return changed
    }

    /// The daemon lists every open request (pending or at the computer) on the newest page and leaves out the ones
    /// that were answered, expired or dropped. A cached open request the newest page no longer lists is closed:
    /// it goes, so no card asks for something nothing waits on any more.
    private mutating func dropClosedRequests(listedIn page: ActivityPage) -> Bool {
        let listed = Set(page.items.map(\.id))
        let before = activities.count
        activities.removeAll { ($0.isPendingRequest || $0.isTerminalRequest) && !listed.contains($0.id) }
        return activities.count != before
    }

    /// Adds an older page in front, skipping ids already present, and moves the paging cursor.
    /// True when the feed changed.
    @discardableResult
    public mutating func prepend(page: ActivityPage) -> Bool {
        var seen = Set(activities.map(\.id))
        let fresh = page.items.filter { seen.insert($0.id).inserted }
        guard !fresh.isEmpty || nextBefore != page.nextBefore else { return false }
        activities = fresh + activities
        nextBefore = page.nextBefore
        if !fresh.isEmpty { rebuildDerived() }
        return true
    }

    private mutating func upsertWithoutRebuild(_ activity: Activity) -> Bool {
        if let index = activities.firstIndex(where: { $0.id == activity.id }) {
            guard activities[index] != activity else { return false }
            activities[index] = activity
            return true
        }
        let insertion = activities.lastIndex { $0.timestamp <= activity.timestamp }.map { $0 + 1 } ?? 0
        activities.insert(activity, at: insertion)
        return true
    }

    private mutating func rebuildDerived() {
        var shown: [Activity] = []
        var pending: [Activity] = []
        var atComputer: [Activity] = []
        shown.reserveCapacity(activities.count)
        for activity in activities {
            if activity.isPendingRequest { pending.append(activity) } else if activity.isTerminalRequest { atComputer.append(activity) } else { shown.append(activity) }
        }
        rows = shown
        pendingRequests = pending
        terminalRequests = atComputer
        blocks = FeedBlock.group(shown)
    }
}
