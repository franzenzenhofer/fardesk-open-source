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

    /// A missing file is an empty list; a file in an older format or a damaged one throws `unreadableFile`, which says
    /// what to do (the bare decoding error only said "the data isn't in the correct format").
    public func load() throws -> MachineList {
        guard FileManager.default.fileExists(atPath: url.path) else { return MachineList() }
        let data = try Data(contentsOf: url)
        do {
            return try JSONDecoder().decode(MachineList.self, from: data)
        } catch is DecodingError {
            throw MachineListError.unreadableFile(path: url.path)
        }
    }

    public func save(_ list: MachineList) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try AtomicFile.write(try encoder.encode(list), to: url)
    }
}
