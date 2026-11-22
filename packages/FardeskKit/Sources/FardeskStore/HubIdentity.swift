import CryptoKit
import FardeskModels
import Foundation

/// How a hub turns its machines into endpoints: URL `<hub>/m/<name>`, and a stable id derived
/// from the machine name so the token slot, the cache and the selection survive every restart.
public enum HubIdentity {
    private static let machinePrefix = "fardesk-hub:"
    private static let tokenPrefix = "fardesk-hub-token:"
    /// Fixed namespace of the name-based (version 5) ids.
    private static let namespace = UUID(uuidString: "6f4a1c52-8d0e-5b3a-9c71-0a2b3d4e5f60") ?? UUID()

    /// The id of the endpoint for a machine name: the same name always gives the same id.
    public static func machineID(name: String) -> UUID {
        nameBasedID(machinePrefix + name)
    }

    /// The token slot of one hub: every hub endpoint uses this one token.
    public static func tokenID(hub: URL) -> UUID {
        nameBasedID(tokenPrefix + hub.absoluteString)
    }

    public static func endpoint(machine name: String, hub: HubLink) -> MachineEndpoint {
        MachineEndpoint(id: machineID(name: name), name: name, url: machineURL(name: name, hub: hub.url))
    }

    /// Hub machines in hub order (the hub itself first).
    public static func endpoints(of state: HubState, hub: HubLink) -> [MachineEndpoint] {
        state.machines.map { endpoint(machine: $0.name, hub: hub) }
    }

    /// `<hub>/m/<percent-encoded name>`; a path prefix on the hub URL is kept.
    public static func machineURL(name: String, hub: URL) -> URL {
        var base = hub.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        let encoded = name.addingPercentEncoding(withAllowedCharacters: segmentAllowed) ?? name
        return URL(string: "\(base)/m/\(encoded)") ?? hub
    }

    private static let segmentAllowed: CharacterSet = {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return allowed
    }()

    private static func nameBasedID(_ name: String) -> UUID {
        var bytes = Array(Insecure.SHA1.hash(data: withUnsafeBytes(of: namespace.uuid) { Data($0) } + Data(name.utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}
