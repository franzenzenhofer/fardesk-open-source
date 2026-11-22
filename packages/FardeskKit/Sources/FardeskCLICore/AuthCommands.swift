import ArgumentParser
import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

struct PairCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "pair", abstract: "Add a machine from its pairing link.")
    @OptionGroup var output: OutputOptions
    @Argument(help: "The fardesk://pair?d=... link printed by `fardeskd pair`.")
    var link: String

    func run(context: CLIContext) async throws {
        guard context.tailscaleIsOn() else { throw CLIError.failed(TailscaleRequirement.offMessage) }
        let workspace = try Workspace(context: context, format: output.format)
        let payload = try PairingLink.parse(link)
        if let hub = workspace.access.hubEndpoint, hub.url.sameOrigin(as: payload.url) {
            return try await pairHub(payload, hub: hub, workspace: workspace)
        }
        let token = try await exchange(payload, workspace: workspace)
        var list = workspace.machines
        let known = list.endpoints.first { $0.url == payload.url }
        let endpoint = MachineEndpoint(payload: payload, id: known?.id ?? UUID())
        list.add(endpoint)
        try workspace.machinesFile.save(list)
        try workspace.tokens.save(token, endpoint.id)
        workspace.print(try PairingRenderer.render(endpoint, options: workspace.options))
    }

    /// A link for the hub itself is the one token every machine is reached with.
    private func pairHub(_ payload: PairingPayload, hub: MachineEndpoint, workspace: Workspace) async throws {
        try workspace.tokens.save(try await exchange(payload, workspace: workspace), hub.id)
        try await workspace.saveHubMachines()
        workspace.print(try PairingRenderer.render(hub, options: workspace.options))
    }

    private func exchange(_ payload: PairingPayload, workspace: Workspace) async throws -> String {
        try await PairingExchange.token(for: payload, deviceName: workspace.context.defaultDeviceName, access: workspace.access)
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct LogoutCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "logout", abstract: "Log out of every machine and forget the tokens.")
    @OptionGroup var output: OutputOptions

    func run(context: CLIContext) async throws {
        let workspace = try Workspace(context: context, format: output.format)
        let results = try await AuthSession(access: workspace.access).logout(apnsToken: nil, machines: workspace.machines)
        let lines = results.map { PerMachineRenderer.Line(machine: $0.machine, problem: $0.problem) }
        workspace.print(try PerMachineRenderer.render(lines, done: "logged out", options: workspace.options))
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct DevicesCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "devices", abstract: "List the devices logged in to each machine.")
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        var machines: [DevicesRenderer.Machine] = []
        for endpoint in try workspace.endpoints(machine: target.machine) {
            do {
                let list = try await workspace.call(endpoint, quick: true) { try await $0.authDevices() }
                machines.append(DevicesRenderer.Machine(name: endpoint.name, devices: list.devices))
            } catch {
                workspace.report(MachineProblem(machine: endpoint.name, error: error))
            }
        }
        workspace.print(try DevicesRenderer.render(machines, options: workspace.options))
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct RevokeCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "revoke", abstract: "Sign a device out everywhere it is logged in (its phone wipes itself)."
    )
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Argument(help: "Device id or name.")
    var device: String?
    @Flag(name: .long, help: "Revoke every device.")
    var all = false
    @Flag(name: .customLong("all-machines"), help: "Revoke on every paired machine.")
    var allMachines = false

    func validate() throws {
        guard (device != nil) != all else { throw ValidationError("Give a device (id or name) or --all, not both and not neither.") }
        guard !(allMachines && target.machine != nil) else {
            throw ValidationError("Use --machine or --all-machines, not both.")
        }
    }

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let endpoints = allMachines ? workspace.machines.endpoints : [try workspace.singleEndpoint(machine: target.machine)]
        var lines: [RevokeRenderer.Line] = []
        for endpoint in endpoints {
            do {
                let result = try await workspace.call(endpoint) { try await $0.revoke(device: device) }
                lines.append(RevokeRenderer.Line(machine: endpoint.name, revoked: result.revoked))
            } catch {
                workspace.report(MachineProblem(machine: endpoint.name, error: error))
            }
        }
        workspace.print(try RevokeRenderer.render(lines, options: workspace.options))
        guard lines.count == endpoints.count else { throw CLIError.failed("Not every machine could be reached") }
    }

    mutating func run() async throws { try await run(context: .current) }
}
