import Foundation

extension TokenStore {
    public static let relativeDefaultPath = ".config/fardesk/tokens.json"

    public static let environmentKey = "FARDESK_TOKENS"

    /// `$FARDESK_TOKENS` when set and non-empty, else `~/.config/fardesk/tokens.json`.
    public static func defaultFileURL(environment: [String: String], home: URL) -> URL {
        ConfigPath.resolve(environmentKey: environmentKey, relativePath: relativeDefaultPath, environment: environment, home: home)
    }

    /// Tokens in one JSON file (machine id to token), mode 0600, atomic replace. For the CLI.
    public static func file(url: URL) -> TokenStore {
        let file = TokenFile(url: url)
        return TokenStore(
            load: { try file.read()[$0.uuidString] },
            save: { token, id in
                var tokens = try file.read()
                tokens[id.uuidString] = token
                try file.write(tokens)
            },
            delete: { id in
                var tokens = try file.read()
                tokens[id.uuidString] = nil
                try file.write(tokens)
            },
            storedMachineIDs: { try file.read().keys.compactMap(UUID.init(uuidString:)) },
            deleteAll: { try file.write([:]) }
        )
    }
}

private struct TokenFile: Sendable {
    let url: URL

    func read() throws -> [String: String] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        guard let tokens = try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: url)) else {
            throw TokenStoreError.corruptTokenFile(path: url.path)
        }
        return tokens
    }

    func write(_ tokens: [String: String]) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try AtomicFile.write(try encoder.encode(tokens), to: url)
    }
}
