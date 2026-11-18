import ArgumentParser
import FardeskModels
import FardeskStore
import Foundation

public enum ExitStatus {
    public static let ok: Int32 = 0
    public static let failure: Int32 = 1
    public static let usage: Int32 = 64
}

/// The root command: `fardesk <subcommand>`.
public struct FardeskCommand: AsyncParsableCommand {
    public static let configuration = CommandConfiguration(
        commandName: "fardesk",
        abstract: "Watch and steer Claude Code sessions on your machines.",
        subcommands: [
            MachinesCommand.self, SessionsCommand.self, ActivityCommand.self, DetailCommand.self,
            ReplyCommand.self, ApproveCommand.self, DenyCommand.self, AnswerCommand.self,
            StopCommand.self, KillCommand.self, ResumeCommand.self, TakeoverCommand.self, ForkCommand.self,
            NewCommand.self, ClearCommand.self, CompactCommand.self, HubCommand.self, PauseCommand.self, EventsCommand.self, CoordinatorCommand.self, FoldersCommand.self, ErrorsCommand.self, PairCommand.self, LoginCommand.self, LogoutCommand.self,
            DevicesCommand.self, RevokeCommand.self, RotatePasswordCommand.self,
        ]
    )

    public init() {}
}

public enum FardeskCLI {
    /// What `errors --report` tells the daemon about this tool.
    public static let version = "1.8.5"
    public static let build = "cli"

    /// Parses and runs one command line and returns the process exit status:
    /// 0 ok, 1 server or transport error, 2 usage.
    public static func execute(_ arguments: [String], context: CLIContext = .live) async -> Int32 {
        let started = context.now()
        let status = await run(arguments, context: context)
        await CLIEvents.record(arguments: arguments, status: status, started: started, context: context)
        return status
    }

    private static func run(_ arguments: [String], context: CLIContext) async -> Int32 {
        await CLIContext.$current.withValue(context) {
            do {
                var command = try FardeskCommand.parseAsRoot(arguments)
                if var asynchronous = command as? any AsyncParsableCommand {
                    try await asynchronous.run()
                } else {
                    try command.run()
                }
                return ExitStatus.ok
            } catch is CancellationError {
                return ExitStatus.ok
            } catch {
                return report(error, arguments: arguments, context: context)
            }
        }
    }

    private static func report(_ error: any Error, arguments: [String], context: CLIContext) -> Int32 {
        let parsing = FardeskCommand.exitCode(for: error)
        if parsing == .success {
            context.output.out(FardeskCommand.fullMessage(for: error))
            return ExitStatus.ok
        }
        if parsing == .validationFailure {
            context.output.err(FardeskCommand.fullMessage(for: error))
            return ExitStatus.usage
        }
        let options = RenderOptions(now: context.now(), format: arguments.contains("--json") ? .json : .human)
        let text = (try? ErrorRenderer.render(error, machine: nil, options: options)) ?? "error: \(error.localizedDescription)"
        context.output.err(text)
        if error.isUserMistake { return ExitStatus.usage }
        return ExitStatus.failure
    }
}
