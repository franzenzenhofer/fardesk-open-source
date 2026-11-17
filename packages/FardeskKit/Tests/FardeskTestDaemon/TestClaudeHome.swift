import Foundation

/// Where the repo's daemon, its fixtures and its build live. Found from this file:
/// packages/FardeskKit/Tests/FardeskTestDaemon/<file>.
public enum RepoPaths {
    public static let root: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url
    }()

    public static let daemon = root.appending(path: "daemon/fardeskd", directoryHint: .isDirectory)
    public static let daemonMain = daemon.appending(path: "dist/main.js")
    public static let fixtures = daemon.appending(path: "test/fixtures", directoryHint: .isDirectory)
}

/// A session the test daemon should know about, built from the daemon's own fixtures.
public struct SeedSession: Sendable {
    public let id: String
    public let transcriptFixture: String
    /// A live registry entry (a real `sleep` process stands in for Claude); nil = an ended session.
    public let live: Bool

    public init(id: String, transcriptFixture: String, live: Bool) {
        self.id = id
        self.transcriptFixture = transcriptFixture
        self.live = live
    }

    /// The session id inside every committed hook fixture.
    public static let hookSessionID = "7d7456e7-072b-4806-8b62-9b9d858ba62a"
    public static let endedSessionID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    public static let editsSessionID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

    public static let standard = [
        SeedSession(id: hookSessionID, transcriptFixture: "01b-minimal-session", live: true),
        SeedSession(id: endedSessionID, transcriptFixture: "01-simple-session", live: false),
        SeedSession(id: editsSessionID, transcriptFixture: "05-edit-write-read-test-run", live: false),
    ]
}


/// A real temporary Claude home (`projects/<dir>/<id>.jsonl`, `sessions/<pid>.json`) plus the
/// live child processes that make registry entries count as running.
final class TestClaudeHome: @unchecked Sendable {
    static let projectDirectory = "-work-project"

    let directory: URL
    private var children: [Process] = []

    init(directory: URL) {
        self.directory = directory
    }

    func transcriptURL(_ sessionID: String) -> URL {
        directory.appending(path: "projects/\(Self.projectDirectory)/\(sessionID).jsonl")
    }

    func seed(_ sessions: [SeedSession]) throws {
        let manager = FileManager.default
        let projects = directory.appending(path: "projects/\(Self.projectDirectory)", directoryHint: .isDirectory)
        try manager.createDirectory(at: projects, withIntermediateDirectories: true)
        try manager.createDirectory(at: directory.appending(path: "sessions"), withIntermediateDirectories: true)
        for session in sessions {
            let source = RepoPaths.fixtures.appending(path: "transcripts/\(session.transcriptFixture).jsonl")
            try manager.copyItem(at: source, to: transcriptURL(session.id))
            if session.live { try writeRegistry(sessionID: session.id) }
        }
    }

    func stopChildren() {
        for child in children where child.isRunning { child.terminate() }
        children = []
    }

    private func writeRegistry(sessionID: String) throws {
        let child = Process()
        child.executableURL = URL(filePath: "/bin/sleep")
        child.arguments = ["3600"]
        try child.run()
        children.append(child)
        let source = RepoPaths.fixtures.appending(path: "registry/busy.json")
        var entry = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as? [String: Any] ?? [:]
        entry["pid"] = Int(child.processIdentifier)
        entry["sessionId"] = sessionID
        entry["updatedAt"] = Int(Date().timeIntervalSince1970 * 1000)
        let data = try JSONSerialization.data(withJSONObject: entry)
        try data.write(to: directory.appending(path: "sessions/\(child.processIdentifier).json"))
    }
}
