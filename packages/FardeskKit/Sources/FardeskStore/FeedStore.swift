import FardeskModels
import Observation

/// The observable holder of one session's feed. A view that reads `feed` is woken only when this session's feed
/// really changed, never by activity of another session and never by the session list.
@MainActor
@Observable
public final class FeedBox {
    public internal(set) var feed = SessionFeed()

    nonisolated init() {}
}

/// Every session's feed, kept outside `AppState` so a stream of activity rows does not touch what the session list reads.
/// The dictionary itself is not observed: only a `FeedBox` is, by the one screen that shows that session.
@MainActor
public final class FeedStore {
    private var boxes: [SessionRef: FeedBox] = [:]

    public init() {}

    /// The box of a session (created empty on first use).
    public func box(for ref: SessionRef) -> FeedBox {
        if let known = boxes[ref] { return known }
        let created = FeedBox()
        boxes[ref] = created
        return created
    }

    public func feed(for ref: SessionRef) -> SessionFeed {
        boxes[ref]?.feed ?? SessionFeed()
    }

    /// Applies one activity; true when the feed changed (an identical row changes nothing and wakes nobody).
    @discardableResult
    public func upsert(_ activity: Activity, for ref: SessionRef) -> Bool {
        change(ref) { $0.upsert(activity) }
    }

    /// Puts a cached feed in place, unless the session already shows rows.
    @discardableResult
    public func restore(_ snapshot: FeedSnapshot, for ref: SessionRef) -> Bool {
        guard feed(for: ref).activities.isEmpty else { return false }
        box(for: ref).feed = SessionFeed(snapshot: snapshot)
        return true
    }

    /// Folds the newest page into the rows already shown.
    @discardableResult
    public func refresh(with page: ActivityPage, for ref: SessionRef) -> Bool {
        change(ref) { $0.refresh(with: page) }
    }

    /// Adds an older page in front of the session's rows.
    @discardableResult
    public func prepend(page: ActivityPage, to ref: SessionRef) -> Bool {
        change(ref) { $0.prepend(page: page) }
    }

    public func removeAll() {
        boxes = [:]
    }

    private func change(_ ref: SessionRef, _ mutation: (inout SessionFeed) -> Bool) -> Bool {
        let box = box(for: ref)
        var updated = box.feed
        guard mutation(&updated) else { return false }
        box.feed = updated
        return true
    }
}
