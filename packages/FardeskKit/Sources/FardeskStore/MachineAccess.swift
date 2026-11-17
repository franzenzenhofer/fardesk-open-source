import FardeskClient
import Foundation
import Synchronization

/// The tokens already read from the keychain (one read per token, not one per call); emptied on login, logout and wipe.
public final class TokenCache: @unchecked Sendable {
    private let values = Mutex<[UUID: String]>([:])

    public init() {}

    func token(_ id: UUID, load: () throws -> String?) throws -> String? {
        if let known = values.withLock({ $0[id] }) { return known }
        guard let loaded = try load() else { return nil }
        values.withLock { $0[id] = loaded }
        return loaded
    }

    public func invalidate() {
        values.withLock { $0 = [:] }
    }
}

public enum MachineAccessError: Error, Equatable, Sendable, LocalizedError {
    case notLoggedIn(machine: String)

    public var errorDescription: String? {
        switch self {
        case .notLoggedIn(let machine): "Not logged in to \(machine). Log in first."
        }
    }
}

/// Builds the authenticated API client for a machine from the token store.
public struct MachineAccess: Sendable {
    public let tokens: TokenStore
    public let timeout: TimeInterval
    /// In hub mode every endpoint shares the one token of the hub.
    public let hub: URL?
    public let tokenCache: TokenCache
    /// Where requests really go (tests make the hub unreachable without changing who the app is logged in to).
    public let transport: URL?

    public init(
        tokens: TokenStore, timeout: TimeInterval = FardeskAPI.defaultTimeout, hub: URL? = nil,
        cache: TokenCache = TokenCache(), transport: URL? = nil
    ) {
        self.tokens = tokens
        self.timeout = timeout
        self.hub = hub
        tokenCache = cache
        self.transport = transport
    }

    /// The same URL with scheme, host and port of the transport (when one is set).
    func rebased(_ url: URL) -> URL {
        guard let transport, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.scheme = transport.scheme
        parts.host = transport.host()
        parts.port = transport.port
        return parts.url ?? url
    }

    /// Where an endpoint's token is stored: its own slot, or the hub's.
    func tokenID(for endpoint: MachineEndpoint) -> UUID {
        hub.map(HubIdentity.tokenID(hub:)) ?? endpoint.id
    }

    /// The hub as an endpoint (login, `GET /v1/hub`); nil without a hub.
    public var hubEndpoint: MachineEndpoint? {
        hub.map { MachineEndpoint(id: HubIdentity.tokenID(hub: $0), name: "hub", url: $0) }
    }

    /// The API for a machine; throws `notLoggedIn` when no token is stored for it.
    public func api(for endpoint: MachineEndpoint, timeout override: TimeInterval? = nil) throws -> FardeskAPI {
        guard let token = try tokenCache.token(tokenID(for: endpoint), load: { try tokens.load(tokenID(for: endpoint)) }) else {
            throw MachineAccessError.notLoggedIn(machine: endpoint.name)
        }
        return FardeskAPI(baseURL: rebased(endpoint.url), token: token, timeout: override ?? timeout)
    }

    /// The API without a token, for the login call.
    public func anonymousAPI(for endpoint: MachineEndpoint) -> FardeskAPI {
        FardeskAPI(baseURL: rebased(endpoint.url), token: nil, timeout: timeout)
    }
}
