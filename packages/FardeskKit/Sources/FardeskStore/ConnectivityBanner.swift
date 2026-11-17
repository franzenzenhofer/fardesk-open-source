import Foundation

#if canImport(Darwin)
import Darwin
#endif

/// The line at the top of the machine list that explains why nothing answers.
public enum ConnectivityBanner: Equatable, Sendable {
    case notOnTailscale
    case tailscaleOnButSilent

    public var text: String {
        switch self {
        case .notOnTailscale: "Not on Tailscale. Turn on Tailscale to reach your machines."
        case .tailscaleOnButSilent: "Tailscale is on, but no machine answers."
        }
    }

    /// Only offered when Tailscale is off: a button that opens the Tailscale app.
    public var opensTailscale: Bool { self == .notOnTailscale }

    /// The banner for the current situation, or nil when nothing is wrong.
    /// `tailscaleIsOn` is only read once every machine has failed to answer.
    public static func decide(connections: [ConnectionState], tailscaleIsOn: () -> Bool) -> ConnectivityBanner? {
        guard !connections.isEmpty else { return nil }
        let settled = connections.allSatisfy { $0 != .connecting }
        let answered = connections.contains(.online) || connections.contains(.loggedOut)
        guard settled, !answered else { return nil }
        return tailscaleIsOn() ? .tailscaleOnButSilent : .notOnTailscale
    }
}

/// Reads this device's network interfaces: Tailscale is on when a `utun` interface carries an
/// address in 100.64.0.0/10 (the CGNAT range Tailscale hands out).
public enum TailscaleInterface {
    public static func isUp() -> Bool {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return false }
        defer { freeifaddrs(list) }
        var node: UnsafeMutablePointer<ifaddrs>? = first
        while let current = node {
            defer { node = current.pointee.ifa_next }
            let name = String(cString: current.pointee.ifa_name)
            guard name.hasPrefix("utun"), let address = current.pointee.ifa_addr,
                  address.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let value = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if isCGNAT(value) { return true }
        }
        return false
    }

    /// 100.64.0.0/10: the first octet is 100 and the top two bits of the second are 01.
    static func isCGNAT(_ address: UInt32) -> Bool {
        (address & 0xFFC0_0000) == 0x6440_0000
    }
}
