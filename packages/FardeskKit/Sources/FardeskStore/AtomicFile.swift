import Foundation

public enum AtomicFileError: Error, Equatable, Sendable, LocalizedError {
    case replaceFailed(path: String, errno: Int32)

    public var errorDescription: String? {
        switch self {
        case .replaceFailed(let path, let code):
            "Could not write \(path): \(String(cString: strerror(code)))"
        }
    }
}

/// Writes a private (mode 0600) file by writing a temporary sibling and renaming it over the target.
enum AtomicFile {
    private static let fileMode: Int = 0o600

    static func write(_ data: Data, to url: URL) throws {
        let manager = FileManager.default
        let directory = url.deletingLastPathComponent()
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appending(path: ".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        _ = manager.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: fileMode])
        let handle = try FileHandle(forWritingTo: temporary)
        try handle.write(contentsOf: data)
        try handle.close()
        guard rename(temporary.path, url.path) == 0 else {
            let code = errno
            try manager.removeItem(at: temporary)
            throw AtomicFileError.replaceFailed(path: url.path, errno: code)
        }
    }
}
