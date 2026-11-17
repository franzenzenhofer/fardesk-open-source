import Testing
import Foundation

private let tempPrefix = "fdk-"

/// A short real temp directory (macOS temp paths are symlinks; Unix socket paths must stay short).
public func makeTemporaryDirectory() throws -> URL {
    let base = URL(filePath: "/tmp", directoryHint: .isDirectory)
    let directory = base.appending(path: tempPrefix + String(UUID().uuidString.prefix(8)), directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

public func freePort() throws -> Int {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw TestDaemonError.noFreePort }
    defer { close(descriptor) }
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    address.sin_port = 0
    let bound = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(descriptor, $0, &length) }
    }
    guard bound == 0, named == 0 else { throw TestDaemonError.noFreePort }
    return Int(UInt16(bigEndian: address.sin_port))
}

/// Polls `check` until it returns true or the timeout passes.
public func waitUntil(
    timeout: Duration = .seconds(10),
    _ check: @Sendable () async throws -> Bool
) async throws -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if try await check() { return true }
        try await Task.sleep(for: .milliseconds(50))
    }
    return false
}

/// What the built daemon in daemon/fardeskd/dist can do, so tests of newer routes can skip with a reason.
public enum DaemonCapabilities {
    /// The built daemon has the /v1/auth routes and the set-password command.
    public static var hasAuth: Bool {
        ["dist/server/authRoutes.js", "dist/cli/authCommands.js"].allSatisfy {
            FileManager.default.fileExists(atPath: RepoPaths.daemon.appending(path: $0).path)
        }
    }

    public static let authSkipReason: Comment = "the built daemon (daemon/fardeskd/dist) has no /v1/auth routes yet"
}
