import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// A machine that could not be asked, with why.
struct MachineProblem: Sendable {
    let machine: String
    let error: any Error
}

/// A session found by id prefix or title, with the machine it lives on.
struct ResolvedSession: Sendable {
    let endpoint: MachineEndpoint
    let api: FardeskAPI
    let session: SessionSummary
}

/// The machines, tokens and render options one command run works with.
struct Workspace: Sendable {
    let context: CLIContext
    let options: RenderOptions
    let machinesFile: MachineListFile
    let machines: MachineList
    let tokens: TokenStore
    let access: MachineAccess
    /// For asking "who answers?": a machine that does not answer within this is reported Offline.
    let probeAccess: MachineAccess
    static let probeTimeout: TimeInterval = 5

    init(context: CLIContext, format: OutputFormat, machines override: MachineList? = nil) throws {
        self.context = context
        options = RenderOptions(now: context.now(), format: format, timeZone: context.timeZone)
        machinesFile = MachineListFile(url: MachineListFile.defaultURL(environment: context.environment, home: context.home))
        tokens = .file(url: TokenStore.defaultFileURL(environment: context.environment, home: context.home))
        let list = try override ?? machinesFile.load()
        machines = list
        access = MachineAccess(tokens: tokens, timeout: context.requestTimeout, hub: list.hub)
        probeAccess = MachineAccess(tokens: tokens, timeout: min(context.requestTimeout, Self.probeTimeout), hub: list.hub)
    }

    func print(_ text: String) {
        context.output.out(text)
    }

    /// Reports a problem on stderr with the machine's name; the contract body in `--json` mode.
    func report(_ problem: MachineProblem) {
        let text = (try? ErrorRenderer.render(problem.error, machine: problem.machine, options: options))
        context.output.err(text ?? "error: \(problem.machine): \(problem.error.localizedDescription)")
    }

    // MARK: Choosing machines

    /// Every machine, or the one whose name starts with `machine`.
    func endpoints(machine: String?) throws -> [MachineEndpoint] {
        guard let machine else { return machines.endpoints }
        return [try machines.find(named: machine)]
    }

    /// The one machine a command acts on: the named one, or the only paired one.
    func singleEndpoint(machine: String?) throws -> MachineEndpoint {
        if let machine { return try machines.find(named: machine) }
        guard machines.endpoints.count == 1, let only = machines.endpoints.first else {
            let names = machines.endpoints.map(\.name).joined(separator: ", ")
            throw CLIError.usage("Pick the machine with --machine (paired: \(names.isEmpty ? "none" : names))")
        }
        return only
    }

    // MARK: Asking machines

    /// Runs one call on a machine. A revoked token deletes this CLI's tokens before the error is thrown.
    func call<Result>(
        _ endpoint: MachineEndpoint,
        quick: Bool = false,
        _ operation: (FardeskAPI) async throws -> Result
    ) async throws -> Result {
        do {
            return try await operation((quick ? probeAccess : access).api(for: endpoint))
        } catch {
            if error.isTokenRevoked { try tokens.deleteAll() }
            throw error
        }
    }

    /// Machines and sessions of every endpoint, asked at the same time. An unreachable or refusing
    /// machine becomes an offline row; the others are unaffected.
    func overview(of endpoints: [MachineEndpoint]) async -> (states: [MachineState], problems: [MachineProblem]) {
        let answers = await withTaskGroup(of: (Int, MachineState, MachineProblem?).self) { group in
            for (index, endpoint) in endpoints.enumerated() {
                group.addTask {
                    let (state, problem) = await self.fetchState(endpoint)
                    return (index, state, problem)
                }
            }
            var all: [(Int, MachineState, MachineProblem?)] = []
            for await answer in group { all.append(answer) }
            return all.sorted { $0.0 < $1.0 }
        }
        return (answers.map(\.1), answers.compactMap(\.2))
    }

    private func fetchState(_ endpoint: MachineEndpoint) async -> (MachineState, MachineProblem?) {
        var state = MachineState(endpoint: endpoint)
        do {
            let (machine, sessions) = try await call(endpoint, quick: true) { api in
                async let machine = api.machine()
                async let sessions = api.sessions()
                return try await (machine, sessions)
            }
            state.apply(.hello(machine: machine, sessions: sessions))
            return (state, nil)
        } catch {
            if let problem = error.machineOfflineMessage {
                state.markOffline(problem: problem, now: context.now())
                return (state, nil)
            }
            state.markFailed(by: error, now: context.now())
            return (state, MachineProblem(machine: endpoint.name, error: error))
        }
    }

    /// A session by unique id prefix or exact title, on the named machine or any machine.
    func resolve(_ query: String, machine: String?) async throws -> ResolvedSession {
        let (states, problems) = await overview(of: try endpoints(machine: machine))
        let entries = states.flatMap { state in state.sessions.map { (machine: state.endpoint.name, session: $0) } }
        guard !entries.isEmpty || problems.isEmpty else { throw problems[0].error }
        let hit = try ShortID.resolve(query, in: entries)
        guard let state = states.first(where: { $0.sessions.contains(hit.session) }) else {
            throw ShortIDError.notFound(query: query)
        }
        return ResolvedSession(endpoint: state.endpoint, api: try access.api(for: state.endpoint), session: hit.session)
    }
}
