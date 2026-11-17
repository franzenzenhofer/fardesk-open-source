import FardeskModels
import Foundation

/// Feeds on disk: opening a session shows the last rows at once and refreshes in the background.
extension AppModel {
    /// How long a changed feed waits before it is written, so a burst of rows is one write.
    static let feedSaveDelay: Duration = .seconds(2)

    /// One activity row from a live stream. It touches only the session's feed, never `state`: the session list,
    /// the machine sections and the other sessions are not woken. An identical row does nothing at all.
    func applyActivity(_ activity: Activity, sessionID: String, from machineID: UUID) {
        let ref = SessionRef(machineID: machineID, sessionID: sessionID)
        do {
            _ = try state.machine(id: machineID)
        } catch {
            return raise(ErrorText.message(machine: machineName(machineID), action: "update the sessions", error: error), area: "update the sessions", error: error, machineID: machineID)
        }
        guard feeds.upsert(activity, for: ref) else { return }
        scheduleFeedSave(ref)
        reconcileOutbox(ref)
        rowsArrived(for: ref)
        onFeedChange?(ref, feeds.feed(for: ref))
    }

    /// Puts the cached rows of a session on screen, unless it already shows some.
    func restoreCachedFeed(_ ref: SessionRef) async {
        let cache = configuration.cache
        let snapshot = await Task.detached { cache.loadFeed(machineID: ref.machineID, sessionID: ref.sessionID) }.value
        guard let snapshot else { return }
        feeds.restore(snapshot, for: ref)
    }

    /// Folds the newest page into the shown rows and writes the result to the cache soon.
    func refreshFeed(with page: ActivityPage, of ref: SessionRef) {
        Breadcrumbs.mark("refresh feed")
        defer { Breadcrumbs.mark("idle") }
        if feeds.refresh(with: page, for: ref) {
            scheduleFeedSave(ref)
            onFeedChange?(ref, feeds.feed(for: ref))
        }
        reconcileOutbox(ref)
        if !page.items.isEmpty { rowsArrived(for: ref) }
    }

    /// Writes the feed of this session soon (many rows in a row are written once).
    func scheduleFeedSave(_ ref: SessionRef) {
        dirtyFeeds.insert(ref)
        guard feedFlush == nil else { return }
        feedFlush = Task { [weak self] in
            try? await Task.sleep(for: Self.feedSaveDelay)
            guard !Task.isCancelled else { return }
            self?.flushFeeds()
        }
    }

    /// Writes every changed feed now. A feed that cannot be cached is not an error the user can fix.
    func flushFeeds() {
        Breadcrumbs.mark("flush feeds")
        defer { Breadcrumbs.mark("idle") }
        feedFlush?.cancel()
        feedFlush = nil
        let dirty = dirtyFeeds
        dirtyFeeds = []
        for ref in dirty {
            let snapshot = feeds.feed(for: ref).snapshot()
            guard !snapshot.activities.isEmpty else { continue }
            cacheWriter.saveFeed(snapshot, machineID: ref.machineID, sessionID: ref.sessionID)
        }
    }
}
