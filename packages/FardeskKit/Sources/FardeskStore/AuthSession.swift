import FardeskClient
import FardeskModels
import Foundation

public struct MachineLogoutResult: Sendable, Equatable {
    public let machine: String
    /// nil when the daemon confirmed the logout; otherwise why it could not be told (the token
    /// is deleted locally either way).
    public let problem: String?
}

/// Logout across all machines. Devices get their token by pairing (`PairingExchange`), never by a password.
public struct AuthSession: Sendable {
    public let access: MachineAccess

    public init(access: MachineAccess) {
        self.access = access
    }

    /// In hub mode only the hub's own token counts: a token for a single machine does not open the hub.
    public func isLoggedIn() throws -> Bool {
        if let hub = access.hubEndpoint { return try access.tokens.load(hub.id) != nil }
        return try access.tokens.hasAnyToken()
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
