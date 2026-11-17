import FardeskClient
import FardeskModels
import Foundation

extension Error {
    var isTransport: Bool {
        if case .transport? = self as? FardeskAPIError { true } else { false }
    }

    /// The hub's sentence when a call was refused because the target machine is offline.
    public var machineOfflineMessage: String? {
        guard case .server(_, let response)? = self as? FardeskAPIError, response.error.code == .machineOffline else {
            return nil
        }
        return response.error.message
    }
}

/// Hub mode: one login to the hub, the machine list and every machine's online state from
/// `GET /v1/hub`, one live stream per online machine through the hub.
extension AppModel {
    public var isHubMode: Bool { machines.hub != nil }

    /// Builds before hub mode logged in to every machine. The token of the machine at the hub's own
    /// address was issued by the hub's daemon, so it becomes the hub token and no new login is needed.
    func adoptDirectTokenForHub(from list: MachineList) throws {
        guard let hub = access.hubEndpoint, try configuration.tokens.load(hub.id) == nil else { return }
        for endpoint in list.endpoints where endpoint.url.sameOrigin(as: hub.url) {
            guard let token = try configuration.tokens.load(endpoint.id) else { continue }
            try configuration.tokens.save(token, hub.id)
            access.tokenCache.invalidate()
            recordEvent("hub", "reused the \(endpoint.name) login for the hub")
            return
        }
    }

    /// Polls the hub now and then every `hubPollInterval` until `stop()`.
    func startHubPolling() {
        hubPoll?.cancel()
        let interval = configuration.hubPollInterval
        hubPoll = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollHub()
                try? await Task.sleep(for: .seconds(interval))
            }
        }
    }

    /// Asks the hub who is online and applies the answer. An unreachable hub shows every machine
    /// offline and says so in words; the poll gives up after `hubPollTimeout`, not the 15 s default.
    public func pollHub() async {
        guard let hub = access.hubEndpoint else { return }
        let started = Date()
        do {
            let answer = try await access.api(for: hub, timeout: configuration.hubPollTimeout).hub()
            knownHubName = answer.hub
            setHubStatus(.reachable, since: started)
            applyHub(answer)
        } catch {
            handleHubFailure(error, since: started)
        }
    }

    /// The name shown for the hub: what the hub called itself, else its machine in the list, else its address.
    public var hubDisplayName: String {
        knownHubName ?? machines.endpoints.first?.name ?? hubAddress
    }

    public var hubAddress: String { machines.hub?.host() ?? "" }

    /// The line for the top of the Machines screen; nil when the hub answers.
    public var hubBannerText: String? {
        hubStatus?.bannerText(hubName: hubDisplayName, address: hubAddress)
    }

    /// Records every change of the hub's reachability as an event with the reason.
    func setHubStatus(_ status: HubStatus, since started: Date) {
        guard hubStatus != status else { return }
        hubStatus = status
        switch status {
        case .reachable: recordEvent("hub", "the hub answers", since: started)
        case .unreachable(let reason): recordEvent("hub", "the hub does not answer: \(reason)", since: started)
        case .connecting: break
        }
    }

    func applyHub(_ hubState: HubState) {
        guard let hub = machines.hub else { return }
        let endpoints = HubIdentity.endpoints(of: hubState, hub: hub)
        let added = endpoints.filter { endpoint in !machines.endpoints.contains(endpoint) }
        var changed = false
        if !added.isEmpty || endpoints.count != machines.endpoints.count {
            adoptHubMachines(endpoints, added: added)
            changed = true
        }
        Breadcrumbs.mark("apply hub")
        defer { Breadcrumbs.mark("idle"); if changed { stateChanged() } }
        for info in hubState.machines {
            let machineID = HubIdentity.machineID(name: info.name)
            let before = (try? state.machine(id: machineID))?.hubInfo
            let wasOnline = before?.online ?? false
            if (try? state.machine(id: machineID))?.wouldChange(by: info) ?? true {
                try? state.apply(hub: info, on: machineID)
                changed = true
            }
            if before != nil, wasOnline != info.online {
                recordEvent("hub", "\(info.name) went \(info.online ? "online" : "offline")\(info.problem.map { ": \($0)" } ?? "")", machineID: machineID)
            }
            guard let endpoint = endpoints.first(where: { $0.id == machineID }) else { continue }
            if info.online, !wasOnline { Task { await flushOutbox(on: machineID) } }
            if info.online, streams[machineID] == nil { openStream(for: endpoint) }
            if !info.online { closeStream(of: machineID) }
        }
    }

    /// A call answered `machine_offline`: the machine shows Offline with the hub's sentence, no alert.
    func markMachineOffline(_ machineID: UUID, problem: String) {
        do {
            try state.markOffline(machineID: machineID, problem: problem, now: Date())
            persist(machineID)
        } catch {
            raise(ErrorText.message(machine: machineName(machineID), action: "update the machine state", error: error), area: "update the machine state", error: error, machineID: machineID)
        }
    }

    /// The list of an older build (one login per machine) becomes the hub list at once: same names,
    /// the cached sessions move to the new ids, so the first screen is not empty while the hub answers.
    func migrate(_ previous: [MachineEndpoint], into list: inout MachineList, hub: URL) throws {
        let moved = previous.map { HubIdentity.endpoint(machine: $0.name, hub: hub) }
        for (old, new) in zip(previous, moved) {
            if let snapshot = configuration.cache.load(machineID: old.id) {
                try configuration.cache.save(MachineSnapshot(machineID: new.id, machine: snapshot.machine, sessions: snapshot.sessions, lastSeen: snapshot.lastSeen))
            }
            if old.url.sameOrigin(as: hub) { knownHubName = old.name }
        }
        list.replaceEndpoints(moved)
        try configuration.machinesFile.save(list)
    }

    private func adoptHubMachines(_ endpoints: [MachineEndpoint], added: [MachineEndpoint]) {
        machines.replaceEndpoints(endpoints)
        state.sync(endpoints: endpoints)
        for endpoint in added {
            guard let snapshot = configuration.cache.load(machineID: endpoint.id) else { continue }
            try? state.restore(snapshot)
        }
        cacheWriter.saveMachines(machines)
    }

    /// The hub refused the token (not revoked, not reachable): streams stop and the login screen asks for the password.
    private func signOutLocally(_ reason: String) {
        stop()
        phase = .loggedOut
        loginError = reason
        recordEvent("hub", reason)
    }

    private func handleHubFailure(_ error: any Error, since started: Date) {
        if error.isTokenRevoked { return wipeEverything(reason: "This device was signed out. Log in again.") }
        if error.meansLoggedOut { return signOutLocally("The hub did not accept this login. Log in again.") }
        if error.isCancellation { return }
        let first = !(hubStatus?.isUnreachable ?? false)
        setHubStatus(.unreachable(reason: ErrorText.detail(error)), since: started)
        if first { report(error, area: "reach the hub") }
        for endpoint in machines.endpoints { markOffline(endpoint.id, after: error) }
    }
}
