import FardeskModels
import Foundation
import Synchronization

/// Writes the offline cache off the main thread: machine snapshots, session feeds and the machine list.
/// Writes are coalesced (the newest value per machine / session wins), happen after a short quiet time, and are
/// skipped when the value equals what is already on disk. A serial queue instead of an actor so that
/// `wipe` can stop pending writes synchronously before the cache directory is removed.
public final class CacheWriter: Sendable {
    public static let delay: TimeInterval = 1

    private struct FeedKey: Hashable {
        let machineID: UUID
        let sessionID: String
    }

    private struct Book {
        var snapshots: [UUID: MachineSnapshot] = [:]
        var feeds: [FeedKey: FeedSnapshot] = [:]
        var machines: MachineList?
    }

    private struct State {
        var pending = Book()
        var written = Book()
        var scheduled = false
        var writes = 0
    }

    private let cache: OfflineCache
    private let machinesFile: MachineListFile
    private let delay: TimeInterval
    private let onFailure: @Sendable (String, any Error) -> Void
    private let queue = DispatchQueue(label: "fardesk.cache-writer", qos: .utility)
    private let state = Mutex(State())

    public init(
        cache: OfflineCache,
        machinesFile: MachineListFile,
        delay: TimeInterval = CacheWriter.delay,
        onFailure: @escaping @Sendable (String, any Error) -> Void = { _, _ in }
    ) {
        self.cache = cache
        self.machinesFile = machinesFile
        self.delay = delay
        self.onFailure = onFailure
    }

    /// How many files were really written (tests: unchanged values must not count).
    public var writes: Int { state.withLock { $0.writes } }

    public func save(_ snapshot: MachineSnapshot) {
        enqueue { book, written in
            book.snapshots[snapshot.machineID] = written.snapshots[snapshot.machineID] == snapshot ? nil : snapshot
        }
    }

    public func saveFeed(_ feed: FeedSnapshot, machineID: UUID, sessionID: String) {
        let key = FeedKey(machineID: machineID, sessionID: sessionID)
        enqueue { book, written in
            book.feeds[key] = written.feeds[key] == feed ? nil : feed
        }
    }

    public func saveMachines(_ list: MachineList) {
        enqueue { book, written in
            book.machines = written.machines == list ? nil : list
        }
    }

    /// Writes everything pending now and returns when it is on disk.
    public func flush() {
        queue.sync { writePending() }
    }

    /// Drops everything pending, then runs `work` (the wipe) on the writer queue: no write can come after it.
    public func wipe(_ work: () throws -> Void) rethrows {
        try queue.sync {
            state.withLock { $0 = State() }
            try work()
        }
    }

    private func enqueue(_ change: (inout Book, Book) -> Void) {
        let schedule = state.withLock { state -> Bool in
            change(&state.pending, state.written)
            guard !state.scheduled else { return false }
            state.scheduled = true
            return true
        }
        guard schedule else { return }
        queue.asyncAfter(deadline: .now() + delay) { self.writePending() }
    }

    private func writePending() {
        let book = state.withLock { state -> Book in
            state.scheduled = false
            let taken = state.pending
            state.pending = Book()
            return taken
        }
        for snapshot in book.snapshots.values { attempt("cache the sessions") { try cache.save(snapshot) } record: { $0.snapshots[snapshot.machineID] = snapshot } }
        for (key, feed) in book.feeds {
            attempt("cache the activity") { try cache.saveFeed(feed, machineID: key.machineID, sessionID: key.sessionID) } record: { $0.feeds[key] = feed }
        }
        if let list = book.machines { attempt("save the machine list") { try machinesFile.save(list) } record: { $0.machines = list } }
    }

    private func attempt(_ what: String, _ write: () throws -> Void, record: (inout Book) -> Void) {
        do {
            try write()
            state.withLock { state in
                record(&state.written)
                state.writes += 1
            }
        } catch {
            onFailure(what, error)
        }
    }
}
