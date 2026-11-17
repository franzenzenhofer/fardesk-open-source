import FardeskClient
import FardeskModels
import Foundation

extension LoginOutcome {
    /// The one sentence the login screen shows when no machine accepted the password.
    public var failureMessage: String {
        let statuses = results.map(\.status)
        if statuses.contains(.wrongPassword) { return "Wrong password." }
        if statuses.contains(.rateLimited) { return "Too many attempts. Try again in a few minutes." }
        let unreachable = results.filter { if case .unreachable = $0.status { true } else { false } }
        guard let first = unreachable.first else { return "Login failed." }
        return "Cannot reach \(first.endpoint.name)."
    }
}

extension AppModel {
    /// Logs in to every machine with one password. The password is not kept.
    public func login(password: String) async {
        phase = .loggingIn
        loginError = nil
        let outcome = await auth.login(password: password, deviceName: configuration.deviceName, machines: machines)
        adopt(outcome)
        if outcome.succeeded { showNotice(ActionFeedback(text: "Logged in", state: .succeeded), in: .list) }
        guard outcome.succeeded else {
            phase = .loggedOut
            loginError = outcome.failureMessage
            return
        }
        phase = .ready
        connectAll()
    }

    /// Adds a machine by address and logs in to it with the same password.
    @discardableResult
    public func addMachine(url: URL, name: String, password: String) async -> Bool {
        let outcome = await auth.add(
            url: url, name: name, password: password, deviceName: configuration.deviceName, machines: machines
        )
        guard outcome.succeeded else {
            enqueueReport(message: outcome.failureMessage, area: "add the machine", code: nil, machineID: nil)
            raise("\(name): could not add the machine: \(outcome.failureMessage)")
            return false
        }
        adopt(outcome)
        connectAll()
        return true
    }

    /// Tells every machine to forget this device, then wipes everything local.
    public func logout(apnsToken: String?) async {
        stop()
        do {
            _ = try await auth.logout(apnsToken: apnsToken, machines: machines)
        } catch {
            raise("Fardesk: could not log out of every machine: \(ErrorText.detail(error))", area: "log out", error: error)
        }
        wipeEverything(reason: nil)
    }

    /// Self-wipe: tokens, offline cache and in-memory state go; the login screen comes back.
    func wipeEverything(reason: String?) {
        stop()
        pushRegistrationKey = nil
        access.tokenCache.invalidate()
        do {
            try cacheWriter.wipe { try localWipe.wipe() }
        } catch {
            raise("Fardesk: could not wipe everything on this device: \(ErrorText.detail(error))", area: "wipe the device", error: error)
        }
        state = AppState(endpoints: machines.endpoints, machineOrder: configuration.machineOrder)
        feeds.removeAll()
        pausedUntil = nil
        phase = .loggedOut
        loginError = reason
    }

    /// Registers this device for push: once per launch for the same token and choices, with the hub alone in hub
    /// mode (it forwards to its machines), else on every machine at the same time.
    public func registerPush(
        apnsToken: String,
        environment: APNsEnvironment,
        notifications: [NotificationType] = [.done, .permission, .question, .ended]
    ) async {
        let request = DeviceRequest(
            apnsToken: apnsToken,
            environment: environment,
            name: configuration.deviceName,
            notifications: notifications
        )
        let key = "\(apnsToken)|\(environment)|\(notifications.map(\.rawValue).joined(separator: ","))"
        guard pushRegistrationKey != key else { return }
        pushRegistrationKey = key
        if let hub = access.hubEndpoint {
            do {
                try await access.api(for: hub).registerDevice(request)
            } catch {
                pushRegistrationKey = nil
                if !error.isTransport { report(error, area: "register for notifications") }
            }
            return
        }
        await withTaskGroup(of: Void.self) { group in
            for endpoint in machines.endpoints {
                group.addTask { _ = await self.perform(on: endpoint.id, action: "register for notifications", origin: .background) { try await $0.registerDevice(request) } }
            }
        }
    }

    /// Revokes one device (id or name) or, with nil, every device on a machine. Returns the count.
    public func revoke(device: String?, on machineID: UUID) async -> Int? {
        await perform(on: machineID, action: "sign the device out") { try await $0.revoke(device: device) }?.revoked
    }

    /// Forgets one machine on this device: its token, its cache and its place in the list.
    public func removeMachine(id: UUID) {
        stop()
        machines.remove(id: id)
        do {
            try configuration.tokens.delete(id)
            access.tokenCache.invalidate()
            cacheWriter.saveMachines(machines)
        } catch {
            raise("Fardesk: could not forget the machine: \(ErrorText.detail(error))", area: "forget the machine", error: error)
        }
        state.sync(endpoints: machines.endpoints)
        connectAll()
    }

    private func adopt(_ outcome: LoginOutcome) {
        machines = outcome.machines
        state.sync(endpoints: machines.endpoints)
        cacheWriter.saveMachines(machines)
    }
}
