import ArgumentParser
import FardeskModels
import FardeskStore

/// `--json`: print the contract JSON instead of text.
struct OutputOptions: ParsableArguments {
    @Flag(name: .long, help: "Print JSON (the daemon's contract documents) instead of text.")
    var json = false

    var format: OutputFormat { json ? .json : .human }
}

/// `--machine`: restrict a command to the machine whose name starts with this text.
struct MachineOption: ParsableArguments {
    @Option(name: .long, help: "Machine name or unique name prefix.")
    var machine: String?
}

/// A session picked by unique id prefix or exact title.
struct SessionArgument: ParsableArguments {
    @Argument(help: "Session id prefix or exact title.")
    var session: String
}

/// Output, machine and session choice together, for every command that acts on one session.
struct SessionCommandOptions: ParsableArguments {
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @OptionGroup var session: SessionArgument

    /// Resolves the session, then runs the body with the workspace and the session found.
    func perform(
        _ context: CLIContext,
        _ body: (Workspace, ResolvedSession) async throws -> Void
    ) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        try await body(workspace, try await workspace.resolve(session.session, machine: target.machine))
    }
}
