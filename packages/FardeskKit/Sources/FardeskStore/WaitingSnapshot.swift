import Foundation

/// What the home-screen widget shows, written by the app as JSON into the App Group container (SPEC 4.5):
/// how many sessions need the user, when that was known, their titles, and the one waiting longest.
public struct WaitingSnapshot: Codable, Equatable, Sendable {
    public let count: Int
    public let updatedAt: Date
    public let titles: [String]
    /// Project name and machine of the session that has been waiting the longest; nil when nothing waits.
    public let oldestTitle: String?
    public let oldestMachine: String?

    public init(state: AppState, now: Date) {
        let waiting = state.needsYouSessions
        let oldest = waiting.min { $0.session.updatedAt < $1.session.updatedAt }
        count = waiting.count
        updatedAt = now
        titles = waiting.map(\.session.title)
        oldestTitle = oldest?.session.title
        oldestMachine = oldest?.machineName
    }

    /// True when the widget would draw the same thing; only the timestamp may differ.
    public func hasSameContent(as other: WaitingSnapshot) -> Bool {
        count == other.count && titles == other.titles
            && oldestTitle == other.oldestTitle && oldestMachine == other.oldestMachine
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    public static func decode(_ data: Data) throws -> WaitingSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(WaitingSnapshot.self, from: data)
    }
}

/// Reads and writes the snapshot file the app and the widget share.
public struct WaitingSnapshotStore: Sendable {
    /// The Info.plist key the build fills with `group.<bundle prefix>.fardesk` (project.yml).
    public static let appGroupInfoKey = "FardeskAppGroup"
    /// The App Group of this build; empty when the Info.plist has no such key (then the shared container is unavailable).
    public static var appGroupID: String { groupName(infoValue: Bundle.main.object(forInfoDictionaryKey: appGroupInfoKey)) }
    static let fileName = "waiting-snapshot.json"

    private let url: URL

    public init(directory: URL) {
        url = directory.appending(path: Self.fileName)
    }

    static func groupName(infoValue: Any?) -> String {
        infoValue as? String ?? ""
    }

    public func read() -> WaitingSnapshot? {
        (try? Data(contentsOf: url)).flatMap { try? WaitingSnapshot.decode($0) }
    }

    /// Writes the snapshot unless the file already shows the same content. True when the file changed,
    /// which is when the widget timelines must be reloaded.
    @discardableResult
    public func save(_ snapshot: WaitingSnapshot) throws -> Bool {
        if let existing = read(), existing.hasSameContent(as: snapshot) { return false }
        try AtomicFile.write(try snapshot.encoded(), to: url)
        return true
    }
}
