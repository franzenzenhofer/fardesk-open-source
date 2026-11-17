import FardeskClient
import FardeskModels
import Foundation

/// How one machine answered a login.
public enum LoginStatus: Sendable, Equatable {
    case success
    case wrongPassword
    case rateLimited
    case unreachable(String)
    case failed(String)

    static func classify(_ error: any Error) -> LoginStatus {
        guard let apiError = error as? FardeskAPIError else { return .failed(ErrorText.detail(error)) }
        switch apiError.code {
        case .unauthorized?: return .wrongPassword
        case .rateLimited?: return .rateLimited
        default: break
        }
        if case .transport(let urlError) = apiError { return .unreachable(urlError.localizedDescription) }
        return .failed(ErrorText.detail(apiError))
    }
}

public struct MachineLoginResult: Sendable, Equatable {
    public let endpoint: MachineEndpoint
    public let status: LoginStatus

    public var succeeded: Bool { status == .success }
}

/// The machine list after the login (peers merged in) and what each machine answered.
public struct LoginOutcome: Sendable, Equatable {
    public let machines: MachineList
    public let results: [MachineLoginResult]

    /// At least one machine accepted the password.
    public var succeeded: Bool { results.contains(where: \.succeeded) }
}

public struct MachineLogoutResult: Sendable, Equatable {
    public let machine: String
    /// nil when the daemon confirmed the logout; otherwise why it could not be told (the token
    /// is deleted locally either way).
    public let problem: String?
}

/// Login and logout across all machines. The password is used in memory only and never stored.
public struct AuthSession: Sendable {
    /// Peers are followed, but a runaway answer must not create an endless machine list.
    public static let maxMachines = 32

    public let access: MachineAccess

    public init(access: MachineAccess) {
        self.access = access
    }

    /// In hub mode only the hub's own token counts: logins to single machines do not open the hub.
    public func isLoggedIn() throws -> Bool {
        if let hub = access.hubEndpoint { return try access.tokens.load(hub.id) != nil }
        return try access.tokens.hasAnyToken()
    }

    /// Logs in to every machine at the same time, stores each token, adds the peers every machine
    /// reports and logs in to the new ones with the same password.
    public func login(password: String, deviceName: String, machines: MachineList) async -> LoginOutcome {
        if let hub = access.hubEndpoint {
            return await loginHub(hub, password: password, deviceName: deviceName, machines: machines)
        }
        return await login(password: password, deviceName: deviceName, machines: machines, targets: machines.endpoints)
    }

    /// Adds one machine by address. It stays in the list only when it accepted the password.
    public func add(url: URL, name: String, password: String, deviceName: String, machines: MachineList) async -> LoginOutcome {
        var extended = machines
        let endpoint = MachineEndpoint(name: name.isEmpty ? (url.host() ?? url.absoluteString) : name, url: url)
        extended.add(endpoint)
        let outcome = await login(password: password, deviceName: deviceName, machines: extended, targets: [endpoint])
        let accepted = outcome.results.first { $0.endpoint.url == url }?.succeeded ?? false
        return accepted ? outcome : LoginOutcome(machines: machines, results: outcome.results)
    }

    /// Tells every machine to revoke this device (best effort), then deletes every local token.
    public func logout(apnsToken: String?, machines: MachineList) async throws -> [MachineLogoutResult] {
        let results = await withTaskGroup(of: MachineLogoutResult?.self) { group in
            for endpoint in access.hubEndpoint.map({ [$0] }) ?? machines.endpoints {
                group.addTask { await logoutOne(endpoint, apnsToken: apnsToken) }
            }
            return await group.compactMap { $0 }.reduce(into: []) { $0.append($1) }
        }
        try access.tokens.deleteAll()
        access.tokenCache.invalidate()
        return results.sorted { $0.machine < $1.machine }
    }

    // MARK: Private

    /// One login to the hub covers every machine behind it; the peers it reports are not followed.
    private func loginHub(
        _ hub: MachineEndpoint,
        password: String,
        deviceName: String,
        machines: MachineList
    ) async -> LoginOutcome {
        let answer = await loginOne(hub, password: password, deviceName: deviceName)
        return LoginOutcome(machines: machines, results: [MachineLoginResult(endpoint: hub, status: answer.status)])
    }

    private func login(
        password: String,
        deviceName: String,
        machines: MachineList,
        targets: [MachineEndpoint]
    ) async -> LoginOutcome {
        var list = machines
        var results: [MachineLoginResult] = []
        var pending = targets
        var seen = Set(machines.endpoints.map(\.url))
        while !pending.isEmpty {
            let round = await loginRound(pending, password: password, deviceName: deviceName)
            pending = []
            for (endpoint, outcome) in round {
                results.append(MachineLoginResult(endpoint: endpoint, status: outcome.status))
                for peer in outcome.peers where seen.insert(peer.url).inserted && list.endpoints.count < Self.maxMachines {
                    let added = MachineEndpoint(name: peer.name, url: peer.url)
                    list.add(added)
                    pending.append(added)
                }
            }
        }
        return LoginOutcome(machines: list, results: results)
    }

    private struct MachineAnswer: Sendable {
        let status: LoginStatus
        let peers: [Peer]
    }

    private func loginRound(
        _ endpoints: [MachineEndpoint],
        password: String,
        deviceName: String
    ) async -> [(MachineEndpoint, MachineAnswer)] {
        await withTaskGroup(of: (MachineEndpoint, MachineAnswer).self) { group in
            for endpoint in endpoints {
                group.addTask {
                    (endpoint, await loginOne(endpoint, password: password, deviceName: deviceName))
                }
            }
            var answers: [(MachineEndpoint, MachineAnswer)] = []
            for await answer in group { answers.append(answer) }
            return endpoints.compactMap { endpoint in answers.first { $0.0.id == endpoint.id } }
        }
    }

    private func loginOne(_ endpoint: MachineEndpoint, password: String, deviceName: String) async -> MachineAnswer {
        do {
            let result = try await access.anonymousAPI(for: endpoint).login(password: password, deviceName: deviceName)
            try access.tokens.save(result.token, endpoint.id)
            access.tokenCache.invalidate()
            return MachineAnswer(status: .success, peers: result.peers)
        } catch {
            return MachineAnswer(status: LoginStatus.classify(error), peers: [])
        }
    }

    private func logoutOne(_ endpoint: MachineEndpoint, apnsToken: String?) async -> MachineLogoutResult? {
        guard let api = try? access.api(for: endpoint) else { return nil }
        do {
            try await api.logout(apnsToken: apnsToken)
            return MachineLogoutResult(machine: endpoint.name, problem: nil)
        } catch {
            return MachineLogoutResult(machine: endpoint.name, problem: ErrorText.detail(error))
        }
    }
}
