import Foundation

/// The machine order the user chose in the app (names, first to last), kept on this device. A missing file is no
/// order (alphabetical); a corrupt file throws.
public struct MachineOrderFile: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() throws -> [String] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([String].self, from: Data(contentsOf: url))
    }

    public func save(_ names: [String]) throws {
        try AtomicFile.write(JSONEncoder().encode(names), to: url)
    }
}
