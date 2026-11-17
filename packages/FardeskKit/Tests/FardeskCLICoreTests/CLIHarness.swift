import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Synchronization

/// Output of one command run, as collected by the harness.
struct CLIResult: Sendable {
    let status: Int32
    let out: [String]
    let err: [String]

    var outText: String { out.joined(separator: "\n") }
    var errText: String { err.joined(separator: "\n") }
}

final class CapturedOutput: Sendable {
    private let lines = Mutex<(out: [String], err: [String])>(([], []))

    var sink: OutputSink {
        OutputSink(
            out: { text in self.lines.withLock { $0.out.append(text) } },
            err: { text in self.lines.withLock { $0.err.append(text) } }
        )
    }

    /// One entry per printed line (a command may print several lines in one call).
    var out: [String] { lines.withLock { $0.out }.flatMap(Self.split) }
    var err: [String] { lines.withLock { $0.err }.flatMap(Self.split) }

    private static func split(_ text: String) -> [String] {
        text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    func clear() { lines.withLock { $0 = ([], []) } }
}

/// Answers the prompts of one command run from a script instead of a terminal.
final class ScriptedInput: Sendable {
    private let secrets: Mutex<[String]>
    private let lines: Mutex<[String]>

    init(secrets: [String], lines: [String]) {
        self.secrets = Mutex(secrets)
        self.lines = Mutex(lines)
    }

    var reader: InputReader {
        InputReader(
            readSecret: { _ in self.secrets.withLock { $0.isEmpty ? "" : $0.removeFirst() } },
            readLine: { self.lines.withLock { $0.isEmpty ? nil : $0.removeFirst() } }
        )
    }
}

/// Runs real `fardesk` command lines in-process against a private home directory.
final class CLIHarness: Sendable {
    let home: URL
    let output = CapturedOutput()

    init(home: URL? = nil) throws {
        self.home = try home ?? makeTemporaryDirectory()
    }

    /// A real daemon, paired through the real `pair` command, and a harness for it.
    @discardableResult
    static func withPairedDaemon<Result: Sendable>(
        isolation: isolated (any Actor)? = #isolation,
        _ body: (CLIHarness, TestDaemon) async throws -> Result
    ) async throws -> Result {
        try await TestDaemon.with { daemon in
            let cli = try CLIHarness()
            try await cli.pair(daemon)
            return try await body(cli, daemon)
        }
    }

    var machinesURL: URL { home.appending(path: ".config/fardesk/machines.json") }
    var tokensURL: URL { home.appending(path: ".config/fardesk/tokens.json") }

    /// A second runner on the same home with its own output, to run commands next to a long one.
    func sibling() throws -> CLIHarness { try CLIHarness(home: home) }

    func context(secrets: [String] = [], lines: [String] = []) -> CLIContext {
        CLIContext(
            output: output.sink,
            input: ScriptedInput(secrets: secrets, lines: lines).reader,
            environment: [:],
            home: home,
            hostName: "test-host",
            timeZone: TimeZone(identifier: "UTC") ?? .current,
            requestTimeout: 5
        )
    }

    @discardableResult
    func run(_ arguments: [String], secrets: [String] = [], lines: [String] = []) async -> CLIResult {
        output.clear()
        let status = await FardeskCLI.execute(arguments, context: context(secrets: secrets, lines: lines))
        return CLIResult(status: status, out: output.out, err: output.err)
    }

    /// Pairs a daemon through the real `pair` command with a link built the way `fardeskd pair` does.
    @discardableResult
    func pair(_ daemon: TestDaemon, name: String = "box") async throws -> CLIResult {
        let result = await run(["pair", try Self.pairingLink(daemon, name: name)])
        guard result.status == 0 else { throw HarnessError.pairFailed(result.errText) }
        return result
    }

    static func pairingLink(_ daemon: TestDaemon, name: String) throws -> String {
        let json = ["v": 1, "name": name, "url": daemon.url.absoluteString, "token": TestDaemon.token] as [String: Any]
        let payload = try FardeskJSON.makeDecoder().decode(PairingPayload.self, from: JSONSerialization.data(withJSONObject: json))
        return try PairingLink.make(payload)
    }

    /// Runs a command again and again until its output satisfies the check (or the time is up).
    func wait(
        _ arguments: [String],
        timeout: Duration = .seconds(10),
        until check: (CLIResult) -> Bool
    ) async throws -> CLIResult {
        let deadline = ContinuousClock.now + timeout
        var result = await run(arguments)
        while !check(result), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(100))
            result = await run(arguments)
        }
        return result
    }
}

enum HarnessError: Error {
    case pairFailed(String)
}

/// The id prefix `fardesk sessions` prints for a session.
func shortID(_ sessionID: String) -> String { ShortID.short(sessionID) }
