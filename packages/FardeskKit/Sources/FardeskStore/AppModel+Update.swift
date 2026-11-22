import CryptoKit
import FardeskClient
import FardeskModels
import Foundation

/// **Update all** (docs/VERSIONING.md, section 5): bring every machine up to the newest release one machine has.
/// With a hub the hub does the relay; without one the app fetches the package from the newest machine and posts it to
/// each older one itself. Either way the app then follows every machine until its version changes.
extension AppModel {
    /// Which machines are older than the newest one, and where the package comes from.
    public var updatePlan: UpdatePlan { UpdatePlan(machines: state.machines) }

    /// A machine of another major: the app shows one plain line for it and uses only its lifeline.
    public func runsDifferentVersion(_ machineID: UUID) -> Bool {
        (try? state.machine(id: machineID))?.machine.map { !$0.isCompatible } ?? false
    }

    /// Whether the machine can do `feature`. A machine whose info has not arrived yet is not judged.
    public func machineSupports(_ feature: MachineFeature, on machineID: UUID) -> Bool {
        guard let machine = (try? state.machine(id: machineID))?.machine else { return true }
        return machine.supports(feature)
    }

    /// The line at the top of the list: an update exists, one runs, or the last one did not finish.
    public var showsUpdateLine: Bool {
        updatePlan.summary != nil || isUpdating || machineUpdates.values.contains { if case .failed = $0 { true } else { false } }
    }

    public var isUpdating: Bool { machineUpdates.values.contains(where: \.isRunning) }

    /// Updates every machine that is older than the newest one; returns when each is updated, failed or given up.
    public func updateAll() async {
        guard isAvailable(.machineUpdate), !isUpdating else { return }
        let plan = updatePlan
        guard let source = plan.source, !plan.isEmpty else { return }
        machineUpdates = Dictionary(uniqueKeysWithValues: plan.targets.map { ($0.id, MachineUpdateProgress.updating) })
        let started = isHubMode ? await startOnHub(plan) : await startByRelay(plan, from: source)
        await follow(started)
        await refresh()
    }

    private func startOnHub(_ plan: UpdatePlan) async -> [VersionedMachine] {
        do {
            guard let hub = access.hubEndpoint else { throw MachineAccessError.notLoggedIn(machine: "hub") }
            let result = try await access.api(for: hub, timeout: FardeskAPI.updateTimeout).hubUpdateAll()
            return plan.targets.filter { target in
                guard let entry = result.machines.first(where: { HubIdentity.machineID(name: $0.name) == target.id }) else {
                    machineUpdates[target.id] = nil
                    return false
                }
                return noteHub(entry, for: target)
            }
        } catch {
            fail(plan.targets, "could not update through the hub: \(ErrorText.detail(error))")
            return []
        }
    }

    /// True when the hub started the machine's update; the other answers settle it here.
    private func noteHub(_ entry: HubUpdateMachine, for target: VersionedMachine) -> Bool {
        switch entry.result {
        case .started: return true
        case .current: machineUpdates[target.id] = nil
        case .failed, .unknown: machineUpdates[target.id] = .failed(message: entry.message ?? "The machine did not take the update")
        }
        return false
    }

    private func startByRelay(_ plan: UpdatePlan, from source: VersionedMachine) async -> [VersionedMachine] {
        let package: Data
        do {
            guard let endpoint = machines.endpoints.first(where: { $0.id == source.id }) else { return [] }
            package = try await access.api(for: endpoint, timeout: FardeskAPI.updateTimeout).updatePackage()
        } catch {
            fail(plan.targets, "could not fetch the update from \(source.name): \(ErrorText.detail(error))")
            return []
        }
        let sha256 = SHA256.hash(data: package).map { String(format: "%02x", $0) }.joined()
        let access = access
        let endpoints = machines.endpoints
        var started: [VersionedMachine] = []
        await withTaskGroup(of: (VersionedMachine, String?).self) { group in
            for target in plan.targets {
                guard let endpoint = endpoints.first(where: { $0.id == target.id }) else { continue }
                group.addTask { (target, await Self.install(package, sha256: sha256, on: endpoint, access: access)) }
            }
            for await (target, problem) in group {
                if let problem { machineUpdates[target.id] = .failed(message: problem) } else { started.append(target) }
            }
        }
        return started
    }

    private nonisolated static func install(_ package: Data, sha256: String, on endpoint: MachineEndpoint, access: MachineAccess) async -> String? {
        do {
            try await access.api(for: endpoint, timeout: FardeskAPI.updateTimeout).installUpdate(package: package, sha256: sha256)
            return nil
        } catch {
            return ErrorText.detail(error)
        }
    }

    private func fail(_ targets: [VersionedMachine], _ message: String) {
        for target in targets { machineUpdates[target.id] = .failed(message: message) }
    }

    private func follow(_ started: [VersionedMachine]) async {
        let (access, interval, giveUp) = (access, configuration.updatePollInterval, configuration.updateGiveUpAfter)
        let endpoints = machines.endpoints
        await withTaskGroup(of: (UUID, MachineUpdateProgress).self) { group in
            for target in started {
                guard let endpoint = endpoints.first(where: { $0.id == target.id }) else { continue }
                group.addTask {
                    (target.id, await Self.wait(for: endpoint, leaving: target.versionText, access: access, every: interval, upTo: giveUp))
                }
            }
            for await (id, progress) in group { machineUpdates[id] = progress }
        }
    }

    /// Reads the machine until its version changes or its update failed; a machine that restarts does not answer
    /// for a while, which is expected and not an error.
    private nonisolated static func wait(
        for endpoint: MachineEndpoint, leaving version: String, access: MachineAccess, every interval: TimeInterval, upTo giveUp: TimeInterval
    ) async -> MachineUpdateProgress {
        let deadline = Date().addingTimeInterval(giveUp)
        while Date() < deadline {
            do { try await Task.sleep(for: .seconds(interval)) } catch { return .failed(message: "Cancelled") }
            guard let machine = try? await access.api(for: endpoint).machine() else { continue }
            if machine.update?.state == .failed {
                return .failed(message: machine.update?.message ?? "The machine could not install the update")
            }
            if machine.version != version { return .updated(version: machine.version) }
        }
        return .failed(message: "Not updated after \(Int(giveUp / 60)) minutes. Check the machine.")
    }
}
