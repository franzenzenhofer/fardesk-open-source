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

/// Where answers come from: plain lines (yes/no questions).
public struct InputReader: Sendable {
    public let readLine: @Sendable () -> String?

    public init(readLine: @escaping @Sendable () -> String?) {
        self.readLine = readLine
    }

    public static let terminal = InputReader(readLine: { Swift.readLine() })
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
    /// Whether this device has a tailnet address; pairing is refused without one.
    public let tailscaleIsOn: @Sendable () -> Bool

    public init(
        output: OutputSink,
        input: InputReader,
        environment: [String: String],
        home: URL,
        hostName: String,
        now: @escaping @Sendable () -> Date = { Date() },
        timeZone: TimeZone = .current,
        requestTimeout: TimeInterval = 15,
        tailscaleIsOn: @escaping @Sendable () -> Bool = TailscaleInterface.isUp
    ) {
        self.output = output
        self.input = input
        self.environment = environment
        self.home = home
        self.hostName = hostName
        self.now = now
        self.timeZone = timeZone
        self.requestTimeout = requestTimeout
        self.tailscaleIsOn = tailscaleIsOn
    }

    public static let live = CLIContext(
        output: .standard,
        input: .terminal,
        environment: ProcessInfo.processInfo.environment,
        home: FileManager.default.homeDirectoryForCurrentUser,
        hostName: Host.current().localizedName ?? ProcessInfo.processInfo.hostName,
        tailscaleIsOn: liveTailscaleIsOn
    )

    /// Tailscale as this device sees it. A DEBUG build (the ATS gate check, scripts/check-ats.sh) may pretend it is on
    /// with `FARDESK_TEST_TAILSCALE=on`, so a sandbox daemon on loopback can be paired; a release build has no such seam.
    private static let liveTailscaleIsOn: @Sendable () -> Bool = {
        #if DEBUG
        if ProcessInfo.processInfo.environment["FARDESK_TEST_TAILSCALE"] == "on" { return true }
        #endif
        return TailscaleInterface.isUp()
    }

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
