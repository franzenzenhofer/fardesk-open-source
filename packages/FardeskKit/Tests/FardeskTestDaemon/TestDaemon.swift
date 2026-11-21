import Foundation

public enum TestDaemonError: Error, CustomStringConvertible {
    case notBuilt(String)
    case neverAnswered(String)
    case noFreePort
    case commandFailed(String)

    public var description: String {
        switch self {
        case .notBuilt(let path): "daemon is not built: \(path) is missing (run npm run build in daemon/fardeskd)"
        case .neverAnswered(let log): "daemon did not answer GET /v1/machine in time. Log:\n\(log)"
        case .noFreePort: "could not find a free TCP port"
        case .commandFailed(let log): "daemon command failed: \(log)"
        }
    }
}

/// A REAL fardeskd child process on 127.0.0.1 with a temp config and a temp Claude home built
/// from the daemon's fixtures. One helper for every Swift test that needs a daemon.
public final class TestDaemon: @unchecked Sendable {
    /// The config bearer token (64 hex characters).
    public static let token = String(repeating: "ab", count: 32)

    public let port: Int
    public let configURL: URL
    public let stateDirectory: URL
    public let root: URL
    let home: TestClaudeHome
    private var server: RunningProcess?
    /// This daemon's share of the machine-wide cap (see DaemonSlot), held while the server runs.
    private var slot: DaemonSlot?

    public var url: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// The daemon runs inside the test sandbox (FARDESK_TEST_SANDBOX, as in the daemon's own tests): it never looks at
    /// or types into a real tmux server, session inbox or terminal. Without it, a kill with --close-tab walked the
    /// seeded process's ancestors up to the tmux pane the test runner itself ran in, and closed it.
    public var daemonEnvironment: [String: String] { ["FARDESK_TEST_SANDBOX": root.path] }
    public var hookSocket: URL { stateDirectory.appending(path: "hook.sock") }

    init(port: Int, root: URL, home: TestClaudeHome, configURL: URL, stateDirectory: URL) {
        self.port = port
        self.root = root
        self.home = home
        self.configURL = configURL
        self.stateDirectory = stateDirectory
    }

    /// Starts a daemon, runs `body`, and always stops the daemon and its helper processes.
    @discardableResult
    public static func with<Result: Sendable>(
        isolation: isolated (any Actor)? = #isolation,
        sessions: [SeedSession] = SeedSession.standard,
        configOverrides: [String: any Sendable] = [:],
        password: String? = nil,
        _ body: (TestDaemon) async throws -> Result
    ) async throws -> Result {
        let daemon = try await start(sessions: sessions, configOverrides: configOverrides, password: password)
        do {
            let result = try await body(daemon)
            await daemon.stop()
            return result
        } catch {
            await daemon.stop()
            throw error
        }
    }

    public static func start(
        sessions: [SeedSession] = SeedSession.standard,
        configOverrides: [String: any Sendable] = [:],
        password: String? = nil
    ) async throws -> TestDaemon {
        guard FileManager.default.fileExists(atPath: RepoPaths.daemonMain.path) else {
            throw TestDaemonError.notBuilt(RepoPaths.daemonMain.path)
        }
        let root = try makeTemporaryDirectory()
        let home = TestClaudeHome(directory: root.appending(path: "claude", directoryHint: .isDirectory))
        try home.seed(sessions)
        let state = root.appending(path: "state", directoryHint: .isDirectory)
        let port = try freePort()
        let configURL = root.appending(path: "config.json")
        let daemon = TestDaemon(port: port, root: root, home: home, configURL: configURL, stateDirectory: state)
        try daemon.writeConfig(overrides: configOverrides)
        if let password { try await daemon.setPassword(password) }
        try await daemon.launch()
        return daemon
    }

    public func transcriptURL(sessionID: String) -> URL { home.transcriptURL(sessionID) }

    /// Appends one raw JSON line to a session's transcript, as Claude Code would.
    public func appendLine(_ raw: String, toSession sessionID: String) throws {
        let handle = try FileHandle(forWritingTo: transcriptURL(sessionID: sessionID))
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((raw + "\n").utf8))
        try handle.close()
    }

    /// Stops the daemon process (SIGTERM) and waits for it; the port and config stay for `launch`.
    public func stopServer() async {
        guard let server else { releaseSlot(); return }
        server.terminate()
        _ = await server.result()
        self.server = nil
        releaseSlot()
    }

    private func releaseSlot() {
        slot?.release()
        slot = nil
    }

    public func launch() async throws {
        if slot == nil { slot = await DaemonSlot.acquire() }
        do {
            try await launchServer()
        } catch {
            releaseSlot()
            throw error
        }
    }

    private func launchServer() async throws {
        let server = try RunningProcess(
            executable: "/usr/bin/env",
            arguments: ["node", RepoPaths.daemonMain.path, "serve", "--config", configURL.path],
            environment: daemonEnvironment
        )
        self.server = server
        try await waitUntilAnswering(server)
    }

    public func stop() async {
        await stopServer()
        home.stopChildren()
    }

    /// Runs `fardeskd <arguments> --config <config>` to completion.
    public func runCommand(_ arguments: [String], stdin: String = "") async throws -> ProcessResult {
        try await RunningProcess.run("node", [RepoPaths.daemonMain.path] + arguments + ["--config", configURL.path], stdin: stdin, environment: daemonEnvironment)
    }

    /// Sets the login password with the daemon's own `set-password` command (password on stdin).
    public func setPassword(_ password: String) async throws {
        let result = try await runCommand(["set-password"], stdin: password + "\n")
        guard result.status == 0 else { throw TestDaemonError.commandFailed(result.error) }
    }

    // MARK: Private

    private func writeConfig(overrides: [String: any Sendable]) throws {
        var config: [String: Any] = [
            "name": "test-box",
            "token": Self.token,
            "bind": ["address": "127.0.0.1", "port": port],
            "claudeHomes": [home.directory.path],
            "stateDir": stateDirectory.path,
            "intervals": ["registryPollMs": 100, "transcriptPollMs": 50, "pingMs": 1000],
            "permissionTimeoutSeconds": 60,
            // The seeded transcripts name invented folders: show their ended sessions anyway.
            "sessions": ["tidyList": false],
            // The Coordinator is off by default; the tests that ask it need it on.
            "coordinator": ["enabled": true],
        ]
        for (key, value) in overrides { config[key] = value }
        try JSONSerialization.data(withJSONObject: config).write(to: configURL)
    }

    private func waitUntilAnswering(_ server: RunningProcess) async throws {
        var request = URLRequest(url: url.appending(path: "v1/machine"), timeoutInterval: 2)
        request.setValue("Bearer \(Self.token)", forHTTPHeaderField: "Authorization")
        for _ in 0..<200 {
            if let (_, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 200 { return }
            guard server.isRunning else { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        server.terminate()
        throw TestDaemonError.neverAnswered(await server.result().error)
    }
}
