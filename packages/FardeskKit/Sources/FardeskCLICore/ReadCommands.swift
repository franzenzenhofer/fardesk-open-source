import ArgumentParser
import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

struct MachinesCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "machines", abstract: "List the paired machines and whether they answer.")
    @OptionGroup var output: OutputOptions

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        if workspace.machines.hub != nil {
            return workspace.print(try HubMachinesRenderer.render(try await workspace.hubState(), options: workspace.options))
        }
        let (states, problems) = await workspace.overview(of: workspace.machines.endpoints)
        workspace.print(try MachinesRenderer.render(states, options: workspace.options))
        problems.filter { !$0.isUnreachable }.forEach(workspace.report)
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct SessionsCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "sessions", abstract: "List the sessions of all machines, waiting first.")
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Flag(name: .long, help: "Keep running and print the list again whenever it changes.")
    var watch = false

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let endpoints = try workspace.endpoints(machine: target.machine)
        let (states, problems) = await workspace.overview(of: endpoints)
        workspace.print(try SessionsRenderer.render(states, options: workspace.options))
        problems.filter { !$0.isUnreachable }.forEach(workspace.report)
        if watch { try await SessionWatcher(workspace: workspace, initial: states).run() }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct ActivityCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "activity", abstract: "Show what a session did, newest rows last.")
    @OptionGroup var common: SessionCommandOptions
    @Flag(name: .long, help: "Keep running and print new rows as they happen.")
    var follow = false
    @Option(name: .long, help: "How many rows to show (the machine's default when omitted).")
    var limit: Int?
    @Option(name: .long, help: "Show the rows before this activity id (the cursor an earlier page ended with).")
    var before: String?
    @Flag(name: .long, help: "Page back through the whole session instead of stopping after one page.")
    var all = false

    func validate() throws {
        if follow, before != nil || all {
            throw ValidationError("--follow shows new rows; it cannot be combined with --before or --all.")
        }
    }

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            let rows = try await workspace.call(found.endpoint) { api in
                try await ActivityPaging.rows(before: before, all: all) {
                    try await api.activity(sessionID: found.session.id, before: $0, limit: limit)
                }
            }
            if !rows.isEmpty { workspace.print(try FeedRenderer.render(rows, options: workspace.options)) }
            if follow { try await ActivityFollower(workspace: workspace, api: found.api, sessionID: found.session.id, printed: rows).run() }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct DetailCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "detail", abstract: "Show the diff or output behind one activity row.")
    @OptionGroup var common: SessionCommandOptions
    @Argument(help: "The activity id (shown by --json).")
    var activity: String

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            let detail = try await workspace.call(found.endpoint) {
                try await $0.detail(sessionID: found.session.id, activityID: activity)
            }
            workspace.print(try DetailRenderer.render(detail, options: workspace.options))
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct FoldersCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "folders", abstract: "List the folders recently used on a machine.")
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        for endpoint in try workspace.endpoints(machine: target.machine) {
            do {
                let folders = try await workspace.call(endpoint) { try await $0.recentFolders() }
                workspace.print(try FoldersRenderer.render(folders, options: workspace.options))
            } catch {
                workspace.report(MachineProblem(machine: endpoint.name, error: error))
            }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

extension MachineProblem {
    /// An unreachable machine is already visible as an offline row.
    var isUnreachable: Bool {
        if case .transport? = error as? FardeskAPIError { true } else { false }
    }
}
