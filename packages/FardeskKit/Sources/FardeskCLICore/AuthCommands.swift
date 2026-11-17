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

struct LoginCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "login", abstract: "Log in to every paired machine with one password."
    )
    @OptionGroup var output: OutputOptions
    @Option(name: .customLong("machine-url"), help: "Add and log in to a machine at this address.")
    var machineURL: String?
    @Option(name: .long, help: "Name for the machine given with --machine-url.")
    var name: String?

    func run(context: CLIContext) async throws {
        let workspace = try Workspace(context: context, format: output.format)
        let address = try machineURL.map(Self.parse)
        guard address != nil || workspace.machines.hub != nil || !workspace.machines.endpoints.isEmpty else {
            throw CLIError.usage("No machines paired. Pass --machine-url http://host:4780 or run `fardesk pair <link>`.")
        }
        let password = try context.input.readSecret("Password: ")
        guard !password.isEmpty else { throw CLIError.usage("The password is empty") }
        let auth = AuthSession(access: workspace.access)
        let device = context.defaultDeviceName
        let outcome = if let address {
            await auth.add(url: address, name: name ?? "", password: password, deviceName: device, machines: workspace.machines)
        } else {
            await auth.login(password: password, deviceName: device, machines: workspace.machines)
        }
        try workspace.machinesFile.save(outcome.machines)
        workspace.print(try LoginRenderer.render(outcome.results, options: workspace.options))
        guard outcome.succeeded else { throw CLIError.failed(outcome.failureMessage) }
        if workspace.machines.hub != nil { try await workspace.saveHubMachines() }
    }

    private static func parse(_ text: String) throws -> URL {
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme), url.host() != nil else {
            throw CLIError.usage("--machine-url must look like http://host:4780")
        }
        return url
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

struct RotatePasswordCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "rotate-password", abstract: "Change the password on every machine (signs every device out)."
    )
    @OptionGroup var output: OutputOptions

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let current = try context.input.readSecret("Current password: ")
        let next = try context.input.readSecret("New password: ")
        guard try context.input.readSecret("Repeat new password: ") == next else {
            throw CLIError.usage("The two new passwords do not match")
        }
        var lines: [PerMachineRenderer.Line] = []
        var changed = MachineList()
        for endpoint in workspace.machines.endpoints {
            do {
                try await workspace.call(endpoint) { try await $0.changePassword(current: current, next: next) }
                changed.add(endpoint)
                lines.append(PerMachineRenderer.Line(machine: endpoint.name, problem: nil))
            } catch {
                lines.append(PerMachineRenderer.Line(machine: endpoint.name, problem: error.localizedDescription))
            }
        }
        lines = await Self.loginAgain(lines, changed: changed, password: next, workspace: workspace)
        workspace.print(try PerMachineRenderer.render(lines, done: "password changed", options: workspace.options))
        guard lines.allSatisfy({ $0.problem == nil }) else { throw CLIError.failed("Not every machine accepted the change") }
    }

    /// A password change signs every device out, this CLI included: log in again with the new one.
    private static func loginAgain(
        _ lines: [PerMachineRenderer.Line],
        changed: MachineList,
        password: String,
        workspace: Workspace
    ) async -> [PerMachineRenderer.Line] {
        let outcome = await AuthSession(access: workspace.access).login(
            password: password, deviceName: workspace.context.defaultDeviceName, machines: changed
        )
        let failed = Dictionary(
            uniqueKeysWithValues: outcome.results.filter { !$0.succeeded }.map { ($0.endpoint.name, "\($0.status)") }
        )
        return lines.map { line in
            failed[line.machine].map { PerMachineRenderer.Line(machine: line.machine, problem: "changed, but logging in again failed: \($0)") } ?? line
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}
