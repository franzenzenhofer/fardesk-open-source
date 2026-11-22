import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// `fardesk sessions --watch`: the whole list again whenever a machine's sessions change.
struct SessionWatcher {
    private enum Item: Sendable {
        case update(UUID, StreamUpdate)
        case failed(MachineProblem)
    }

    let workspace: Workspace
    let initial: [MachineState]

    func run() async throws {
        var state = AppState(machines: initial)
        for await item in merged() {
            switch item {
            case .failed(let problem): workspace.report(problem)
            case .update(let id, let update):
                guard try apply(update, from: id, to: &state) else { continue }
                workspace.print(try SessionsRenderer.render(state.machines, options: workspace.options))
            }
        }
    }

    /// True when the update changes what the list shows.
    private func apply(_ update: StreamUpdate, from id: UUID, to state: inout AppState) throws -> Bool {
        switch update {
        case .event(let event):
            try state.apply(event, from: id)
            switch event {
            case .hello, .session: return true
            case .activity, .ping, .unknown: return false
            }
        case .disconnected:
            try state.markOffline(machineID: id, now: workspace.context.now())
            return true
        case .connecting, .connected:
            return false
        }
    }

    private func merged() -> AsyncStream<Item> {
        AsyncStream { continuation in
            let runner = Task {
                await withTaskGroup(of: Void.self) { group in
                    for machine in initial {
                        group.addTask { await pump(machine.endpoint, into: continuation) }
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in runner.cancel() }
        }
    }

    private func pump(_ endpoint: MachineEndpoint, into continuation: AsyncStream<Item>.Continuation) async {
        do {
            let api = try workspace.access.api(for: endpoint)
            for try await update in ReconnectingStream(api: api).updates() {
                continuation.yield(.update(endpoint.id, update))
            }
        } catch {
            continuation.yield(.failed(MachineProblem(machine: endpoint.name, error: error)))
        }
    }
}
