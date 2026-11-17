import ArgumentParser
import FardeskModels
import FardeskStore
import Foundation

struct HubCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "hub", abstract: "Show, set or clear the hub (the machine all calls go through)."
    )
    @OptionGroup var output: OutputOptions
    @Option(name: .long, help: "Go through the hub at this address, e.g. http://100.64.0.10:4780.")
    var set: String?
    @Flag(name: .long, help: "Stop using a hub and talk to every machine itself.")
    var clear = false

    func validate() throws {
        guard !(set != nil && clear) else { throw ValidationError("Use --set or --clear, not both.") }
    }

    func run(context: CLIContext) async throws {
        let workspace = try Workspace(context: context, format: output.format)
        guard set != nil || clear else { return try await show(workspace) }
        var list = workspace.machines
        list.setHub(try set.map(Self.parse))
        try workspace.machinesFile.save(list)
        workspace.print(try describe(list.hub, workspace))
    }

    private static func parse(_ text: String) throws -> URL {
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme), url.host() != nil else {
            throw CLIError.usage("--set must look like http://host:4780")
        }
        return url
    }

    /// `hub` shows the hub; with --json it is the hub's own answer (`GET /v1/hub`, the HubState).
    private func show(_ workspace: Workspace) async throws {
        guard output.format == .json else { return workspace.print(try describe(workspace.machines.hub, workspace)) }
        workspace.print(try HubMachinesRenderer.render(try await workspace.hubState(), options: workspace.options))
    }

    private func describe(_ hub: URL?, _ workspace: Workspace) throws -> String {
        if output.format == .json { return try JSONOutput.compact(HubShown(hub: hub?.absoluteString)) }
        return hub.map { "Hub: \($0.absoluteString). Run `fardesk login` once, then `fardesk machines`." }
            ?? "No hub: every machine is asked directly"
    }

    private struct HubShown: Encodable {
        let hub: String?
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct CompactCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "compact", abstract: "Have Claude write a summary and continue from it (/compact); prints the session to continue in."
    )
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.started(on: found) { try await $0.compact(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct ClearCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "clear", abstract: "Start a fresh conversation in a session (/clear) and print the new session."
    )
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.started(on: found) { try await $0.clear(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

extension PermissionMode: ExpressibleByArgument {
    private static let named: [PermissionMode] = [.bypassPermissions, .auto, .acceptEdits, .default, .plan, .dontAsk]

    public init?(argument: String) {
        guard let mode = Self.named.first(where: { $0.rawValue == argument }) else { return nil }
        self = mode
    }

    public static var allValueStrings: [String] { named.map(\.rawValue) }
}
