import ArgumentParser
import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// `fardesk coordinator "<text>"`: talks to the coordinator session of a machine and follows its reply.
struct CoordinatorCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "coordinator",
        abstract: "Ask the coordinator to start, check or stop sessions, and follow its answer.",
        aliases: ["ask"]
    )
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Flag(name: .long, help: "Follow the current coordinator session without sending anything.")
    var open = false
    @Option(name: .long, help: "Stop following after this many seconds.")
    var timeout: Double = FollowStop.defaultTimeout
    @Argument(help: "What you want, in plain words.")
    var text: [String] = []

    func validate() throws {
        guard timeout > 0 else { throw ValidationError("--timeout must be a positive number of seconds.") }
        if open == !text.isEmpty {
            throw ValidationError("Give the text to send, or --open to follow the current coordinator session.")
        }
    }

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let endpoint = try firstOrNamed(workspace)
        let sessionID = try await open ? currentSession(workspace, endpoint) : ask(workspace, endpoint)
        workspace.print(try ActionRenderer.renderCoordinator(sessionID, machine: endpoint.name, options: workspace.options))
        let page = try await workspace.call(endpoint) { try await $0.activity(sessionID: sessionID) }
        let rows = page.items
        if !rows.isEmpty { workspace.print(try FeedRenderer.render(rows, options: workspace.options)) }
        try await ActivityFollower(workspace: workspace, api: try workspace.access.api(for: endpoint), sessionID: sessionID, printed: rows, endsWithTurn: true, timeout: timeout).run()
    }

    /// The named machine, or the first configured one.
    private func firstOrNamed(_ workspace: Workspace) throws -> MachineEndpoint {
        guard target.machine != nil || !workspace.machines.endpoints.isEmpty else {
            throw CLIError.usage("No machine is paired. Run fardesk pair first.")
        }
        return try workspace.endpoints(machine: target.machine)[0]
    }

    private func ask(_ workspace: Workspace, _ endpoint: MachineEndpoint) async throws -> String {
        let prompt = text.joined(separator: " ")
        return try await workspace.call(endpoint) { try await $0.askCoordinator(prompt: prompt) }.sessionId
    }

    private func currentSession(_ workspace: Workspace, _ endpoint: MachineEndpoint) async throws -> String {
        let state = try await workspace.call(endpoint) { try await $0.coordinatorState() }
        guard let sessionID = state.sessionId else {
            throw CLIError.failed("No coordinator session on \(endpoint.name) yet. Start one: fardesk coordinator \"<text>\"")
        }
        return sessionID
    }

    mutating func run() async throws { try await run(context: .current) }
}
