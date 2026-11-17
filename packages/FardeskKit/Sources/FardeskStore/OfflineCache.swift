import FardeskModels
import Foundation

/// The latest `MachineSnapshot` per machine as JSON files in one directory, so offline machines
/// still show their last known sessions. Removing the directory removes everything cached.
public struct OfflineCache: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public func save(_ snapshot: MachineSnapshot) throws {
        try AtomicFile.write(try FardeskJSON.makeEncoder().encode(snapshot), to: file(for: snapshot.machineID))
    }

    /// A missing or unreadable snapshot is simply not cached: the live stream replaces it anyway.
    public func load(machineID: UUID) -> MachineSnapshot? {
        guard let data = try? Data(contentsOf: file(for: machineID)) else { return nil }
        return try? FardeskJSON.makeDecoder().decode(MachineSnapshot.self, from: data)
    }

    /// The newest rows of one session, so opening it shows content before the machine answers.
    public func saveFeed(_ feed: FeedSnapshot, machineID: UUID, sessionID: String) throws {
        try AtomicFile.write(try FardeskJSON.makeEncoder().encode(feed), to: feedFile(machineID: machineID, sessionID: sessionID))
    }

    /// A missing or unreadable file is no cache: the refresh fills the feed anyway.
    public func loadFeed(machineID: UUID, sessionID: String) -> FeedSnapshot? {
        guard let data = try? Data(contentsOf: feedFile(machineID: machineID, sessionID: sessionID)) else { return nil }
        return try? FardeskJSON.makeDecoder().decode(FeedSnapshot.self, from: data)
    }

    /// The coordinator session id of the hub machine, so the Coordinator screen opens on its feed at once.
    public func saveCoordinatorID(_ id: String?) {
        let file = directory.appending(path: "coordinator-id.txt")
        guard let id else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        try? AtomicFile.write(Data(id.utf8), to: file)
    }

    public func loadCoordinatorID() -> String? {
        (try? String(contentsOf: directory.appending(path: "coordinator-id.txt"), encoding: .utf8)).flatMap { $0.isEmpty ? nil : $0 }
    }

    public var exists: Bool { FileManager.default.fileExists(atPath: directory.path) }

    /// Deletes the whole cache directory (a missing directory is fine).
    public func removeAll() throws {
        guard exists else { return }
        try FileManager.default.removeItem(at: directory)
    }

    private func file(for machineID: UUID) -> URL {
        directory.appending(path: "\(machineID.uuidString).json")
    }

    private func feedFile(machineID: UUID, sessionID: String) -> URL {
        let safe = sessionID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? sessionID
        return directory.appending(path: "feeds", directoryHint: .isDirectory)
            .appending(path: machineID.uuidString, directoryHint: .isDirectory)
            .appending(path: "\(safe).json")
    }
}

/// Self-wipe: every token and everything cached goes. The caller clears its in-memory state.
public struct LocalWipe: Sendable {
    public let tokens: TokenStore
    public let cache: OfflineCache

    public init(tokens: TokenStore, cache: OfflineCache) {
        self.tokens = tokens
        self.cache = cache
    }

    /// Both deletions are always attempted; the first failure is thrown afterwards.
    public func wipe() throws {
        var firstFailure: (any Error)?
        do { try tokens.deleteAll() } catch { firstFailure = error }
        do { try cache.removeAll() } catch { firstFailure = firstFailure ?? error }
        if let firstFailure { throw firstFailure }
    }
}
