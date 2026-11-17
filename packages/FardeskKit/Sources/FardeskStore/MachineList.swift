import Foundation

public enum MachineListError: Error, Equatable, Sendable, LocalizedError {
    case unknown(query: String, available: [String])
    case ambiguous(query: String, candidates: [String])

    public var errorDescription: String? {
        switch self {
        case .unknown(let query, let available):
            let names = available.isEmpty ? "none paired" : available.joined(separator: ", ")
            return "No machine named \"\(query)\" (machines: \(names))"
        case .ambiguous(let query, let candidates):
            return "\"\(query)\" matches several machines: \(candidates.joined(separator: ", "))"
        }
    }
}

/// The paired machines as a pure value: add, remove and find by name.
public struct MachineList: Codable, Equatable, Sendable {
    public private(set) var endpoints: [MachineEndpoint]
    /// The hub every call goes through; nil = talk to each machine itself. With a hub the
    /// endpoints are its machines, kept here only so a restart shows them before the hub answers.
    public private(set) var hub: URL?

    public init(endpoints: [MachineEndpoint] = [], hub: URL? = nil) {
        self.endpoints = endpoints
        self.hub = hub
    }

    /// Switches hub mode on (or off with nil). The endpoints stay only while the hub stays the same.
    public mutating func setHub(_ url: URL?) {
        if url != hub { endpoints = [] }
        hub = url
    }

    /// Replaces the endpoints with the hub's machines.
    public mutating func replaceEndpoints(_ list: [MachineEndpoint]) {
        endpoints = list
    }

    /// Adds the endpoint; an existing entry with the same URL is replaced in place.
    public mutating func add(_ endpoint: MachineEndpoint) {
        guard let index = endpoints.firstIndex(where: { $0.url == endpoint.url }) else {
            endpoints.append(endpoint)
            return
        }
        endpoints[index] = endpoint
    }

    public mutating func remove(id: UUID) {
        endpoints.removeAll { $0.id == id }
    }

    public func find(named query: String) throws -> MachineEndpoint {
        switch UniquePrefix.resolve(query, in: endpoints, name: \.name) {
        case .unique(let endpoint):
            return endpoint
        case .ambiguous(let matches):
            throw MachineListError.ambiguous(query: query, candidates: matches.map(\.name))
        case .none:
            throw MachineListError.unknown(query: query, available: endpoints.map(\.name))
        }
    }

    /// Removes the machine matching the name and returns it.
    @discardableResult
    public mutating func remove(named query: String) throws -> MachineEndpoint {
        let removed = try find(named: query)
        endpoints.removeAll { $0.id == removed.id }
        return removed
    }
}
