import FardeskClient
import FardeskDemo
import FardeskModels
import Foundation

/// Demo mode: a second model, fed by pretend machines in memory instead of real ones. It has its own scratch folder,
/// never sees a token, and talks to no network; the real model (and its saved machines) stays untouched under it.
extension AppModel {
    /// A model that shows `world`. Call `start()` (it opens the demo) and `endDemo()` when the user leaves.
    public static func makeDemo(world: DemoWorld) -> AppModel {
        let scratch = FileManager.default.temporaryDirectory.appending(path: "fardesk-demo-\(UUID().uuidString)", directoryHint: .isDirectory)
        let configuration = AppModelConfiguration(
            machinesFile: MachineListFile(url: scratch.appending(path: "machines.json")),
            tokens: .file(url: scratch.appending(path: "tokens.json")),
            cache: OfflineCache(directory: scratch.appending(path: "cache", directoryHint: .isDirectory)),
            deviceName: "Demo",
            tailscaleIsOn: { true }
        )
        let model = AppModel(configuration: configuration)
        model.demo = world
        model.demoScratch = scratch
        return model
    }


    public var isDemo: Bool { demo != nil }

    /// Puts the pretend machines and their sessions in place and starts listening to what the demo changes.
    func startDemo() {
        guard let world = demo, phase != .ready else { return }
        machines = MachineList(endpoints: world.machines.map { MachineEndpoint(id: $0.id, name: $0.name, url: $0.url) })
        state.sync(endpoints: machines.endpoints)
        do {
            for machine in world.machines { apply(try world.hello(for: machine.id), from: machine.id) }
        } catch {
            return raise("Fardesk: could not open the demo: \(ErrorText.detail(error))", area: "open the demo", error: error)
        }
        phase = .ready
        demoEvents = Task { [weak self] in
            for await change in world.events { self?.apply(change.event, from: change.machineID) }
        }
    }

    /// Leaves the demo: stops listening and deletes the scratch folder. The model is not used again.
    public func endDemo() {
        demoEvents?.cancel()
        demoEvents = nil
        guard let scratch = demoScratch else { return }
        demoScratch = nil
        cacheWriter.wipe { try? FileManager.default.removeItem(at: scratch) }
    }

    /// The service for one machine: the HTTP client for a real one, the demo world's for a pretend one.
    func service(for endpoint: MachineEndpoint) throws -> any FardeskService {
        if let demo { return try demo.service(for: endpoint.id) }
        return try access.api(for: endpoint)
    }
}

extension AppModel {
    /// Like `perform`, for what only a real machine can do (devices, push registration). A demo machine refuses it.
    func performOnMachine<Result>(
        on machineID: UUID, action: String, origin: CallOrigin = .user, _ call: (FardeskAPI) async throws -> Result
    ) async -> Result? {
        await perform(on: machineID, action: action, origin: origin) { service in
            guard let api = service as? FardeskAPI else { throw DemoError.notAvailable(action) }
            return try await call(api)
        }
    }
}
