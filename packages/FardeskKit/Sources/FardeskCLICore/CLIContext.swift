import FardeskStore
import Foundation

/// Where command output goes. Tests collect it; the real CLI writes to stdout and stderr.
public struct OutputSink: Sendable {
    public let out: @Sendable (String) -> Void
    public let err: @Sendable (String) -> Void

    public init(out: @escaping @Sendable (String) -> Void, err: @escaping @Sendable (String) -> Void) {
        self.out = out
        self.err = err
    }

    public static let standard = OutputSink(
        out: { FileHandle.standardOutput.write(Data(($0 + "\n").utf8)) },
        err: { FileHandle.standardError.write(Data(($0 + "\n").utf8)) }
    )
}

/// Where answers come from: secrets without echo, plain lines, yes/no.
public struct InputReader: Sendable {
    public let readSecret: @Sendable (String) throws -> String
    public let readLine: @Sendable () -> String?

    public init(
        readSecret: @escaping @Sendable (String) throws -> String,
        readLine: @escaping @Sendable () -> String?
    ) {
        self.readSecret = readSecret
        self.readLine = readLine
    }

    /// A terminal asks with echo off (`readpassphrase`); a pipe supplies one line from stdin.
    public static let terminal = InputReader(
        readSecret: { prompt in
            guard isatty(STDIN_FILENO) != 0 else { return Swift.readLine() ?? "" }
            var buffer = [CChar](repeating: 0, count: 1024)
            guard readpassphrase(prompt, &buffer, buffer.count, RPP_REQUIRE_TTY) != nil else {
                throw CLIError.usage("could not read the password from the terminal")
            }
            return String(cString: buffer)
        },
        readLine: { Swift.readLine() }
    )
}

/// Everything a command may touch outside its arguments, so tests can run commands in-process.
public struct CLIContext: Sendable {
    public let output: OutputSink
    public let input: InputReader
    public let environment: [String: String]
    public let home: URL
    public let hostName: String
    public let now: @Sendable () -> Date
    public let timeZone: TimeZone
    public let requestTimeout: TimeInterval

    public init(
        output: OutputSink,
        input: InputReader,
        environment: [String: String],
        home: URL,
        hostName: String,
        now: @escaping @Sendable () -> Date = { Date() },
        timeZone: TimeZone = .current,
        requestTimeout: TimeInterval = 15
    ) {
        self.output = output
        self.input = input
        self.environment = environment
        self.home = home
        self.hostName = hostName
        self.now = now
        self.timeZone = timeZone
        self.requestTimeout = requestTimeout
    }

    public static let live = CLIContext(
        output: .standard,
        input: .terminal,
        environment: ProcessInfo.processInfo.environment,
        home: FileManager.default.homeDirectoryForCurrentUser,
        hostName: Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    )

    @TaskLocal public static var current: CLIContext = .live

    public var defaultDeviceName: String { "\(hostName) CLI" }

    /// Asks a yes/no question on stderr; anything but y or yes is no.
    public func confirm(_ question: String) -> Bool {
        output.err("\(question) [y/N]")
        let answer = input.readLine()?.trimmingCharacters(in: .whitespaces).lowercased()
        return answer == "y" || answer == "yes"
    }
}

public enum CLIError: Error, Equatable, Sendable, LocalizedError {
    /// Wrong or missing arguments: exit code 2.
    case usage(String)
    /// The command could not do what was asked: exit code 1.
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .usage(let message), .failed(let message): message
        }
    }
}
