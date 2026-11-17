import Foundation

/// The machine list on disk: JSON, mode 0600, atomic replace. No secrets: tokens live in the `TokenStore`.
public struct MachineListFile: Sendable {
    public static let environmentKey = "FARDESK_MACHINES"
    public static let relativeDefaultPath = ".config/fardesk/machines.json"

    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// `$FARDESK_MACHINES` when set and non-empty, else `~/.config/fardesk/machines.json`.
    public static func defaultURL(environment: [String: String], home: URL) -> URL {
        ConfigPath.resolve(environmentKey: environmentKey, relativePath: relativeDefaultPath, environment: environment, home: home)
    }

    /// A missing file is an empty list; an unreadable or corrupt file throws.
    public func load() throws -> MachineList {
        guard FileManager.default.fileExists(atPath: url.path) else { return MachineList() }
        return try JSONDecoder().decode(MachineList.self, from: Data(contentsOf: url))
    }

    public func save(_ list: MachineList) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try AtomicFile.write(try encoder.encode(list), to: url)
    }
}
