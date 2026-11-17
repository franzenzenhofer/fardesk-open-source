import Foundation

/// Where a config file lives: an environment override when set and non-empty, else a path under home.
enum ConfigPath {
    static func resolve(environmentKey: String, relativePath: String, environment: [String: String], home: URL) -> URL {
        guard let override = environment[environmentKey], !override.isEmpty else {
            return home.appending(path: relativePath)
        }
        return URL(filePath: override)
    }
}
