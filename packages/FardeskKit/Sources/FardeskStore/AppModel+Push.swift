import FardeskClient
import FardeskModels
import Foundation

extension AppModel {
    /// Carries out a push action. Returns the session to show, when the action opens one.
    @discardableResult
    public func handle(_ action: PushAction) async -> SessionRef? {
        switch action {
        case .wipe:
            wipe()
            return nil
        case .open(let target):
            return ref(for: target)
        case .decide(let decision, let target):
            guard let ref = ref(for: target), let requestID = target.requestID else { return nil }
            await decide(decision, requestID: requestID, in: ref)
            return ref
        case .answer(let option, let target):
            guard let ref = ref(for: target), let requestID = target.requestID else { return nil }
            await answer(option, requestID: requestID, in: ref)
            return ref
        case .reply(let text, let target):
            guard let ref = ref(for: target) else { return nil }
            await send(text, to: ref)
            return ref
        }
    }

    /// Self-wipe on the daemon's command: tokens, cache and in-memory state go.
    public func wipe() {
        wipeEverything(reason: nil)
    }

    /// Pairs by a `fardesk://pair?...` link, no password: a one-time code is exchanged for this device's own
    /// token (an old link carries the permanent token and is used as is); the machine and the token are stored.
    public func pair(link: String) async {
        do {
            let payload = try PairingLink.parse(link)
            if let hub = access.hubEndpoint {
                return await pairHub(payload, hub: hub)
            }
            let token = try await PairingExchange.token(for: payload, deviceName: configuration.deviceName, access: access)
            let existing = machines.endpoints.first { $0.url == payload.url }
            let endpoint = MachineEndpoint(payload: payload, id: existing?.id ?? UUID())
            try configuration.tokens.save(token, endpoint.id)
            access.tokenCache.invalidate()
            machines.add(endpoint)
            cacheWriter.saveMachines(machines)
            state.sync(endpoints: machines.endpoints)
            loginError = nil
            phase = .ready
            connectAll()
        } catch {
            loginError = "Pairing failed: \(ErrorText.detail(error))"
        }
    }

    /// A link for the hub is the one token every machine is reached with. It is checked against the
    /// hub before the app says "paired"; a link for any other address is refused in words.
    private func pairHub(_ payload: PairingPayload, hub: MachineEndpoint) async {
        guard hub.url.sameOrigin(as: payload.url) else {
            loginError = "This link is for \(payload.name) (\(payload.url.absoluteString)), not for the hub \(hubDisplayName) (\(hub.url.absoluteString)). Use the link of the hub."
            return
        }
        phase = .loggingIn
        loginError = nil
        let answer: HubState
        let token: String
        do {
            token = try await PairingExchange.token(for: payload, deviceName: configuration.deviceName, access: access)
            answer = try await FardeskAPI(baseURL: hub.url, token: token, timeout: configuration.hubPollTimeout).hub()
        } catch {
            return failPairing("the hub at \(hub.url.absoluteString) did not accept the link: \(ErrorText.detail(error))")
        }
        do {
            try configuration.tokens.save(token, hub.id)
        } catch {
            // 2026-11-16: an unsigned build failed here with Keychain -34018 and the old text blamed the hub.
            return failPairing("the hub accepted the link, but this device could not store the login: \(ErrorText.detail(error))")
        }
        access.tokenCache.invalidate()
        knownHubName = answer.hub
        phase = .ready
        showNotice(ActionFeedback(text: "Paired with the hub (\(answer.hub))", state: .succeeded), in: .list)
        connectAll()
    }

    private func failPairing(_ reason: String) {
        phase = .loggedOut
        loginError = "Pairing failed: \(reason)"
    }

    private func ref(for target: PushTarget) -> SessionRef? {
        guard let endpoint = try? machines.find(named: target.machine) else { return nil }
        return SessionRef(machineID: endpoint.id, sessionID: target.sessionID)
    }
}
