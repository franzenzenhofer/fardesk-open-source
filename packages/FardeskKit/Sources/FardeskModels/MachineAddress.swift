import Foundation

/// Why an address was refused: it is not a tailnet address. The words are the ones the person sees.
public struct MachineAddressError: Error, Equatable, Sendable, LocalizedError {
    public let subject: Subject

    public enum Subject: Sendable, Equatable {
        case link
        case address
    }

    public static let link = MachineAddressError(subject: .link)
    public static let address = MachineAddressError(subject: .address)

    public var errorDescription: String? {
        switch subject {
        case .link: "Fardesk only connects inside your tailnet; this link points elsewhere."
        case .address: "Fardesk only connects inside your tailnet; this address points elsewhere."
        }
    }
}

/// The one rule for where Fardesk talks to a machine (Tailscale only, no other way): `http` on an IPv4 address in
/// 100.64.0.0/10, the range Tailscale hands out. No host name, no LAN address, no public address, no https: Tailscale (WireGuard) encrypts the link and Fardesk adds no TLS of its own.
/// The pairing link, the hub setting and the CLI's machine URL options all go through here; so does the daemon's own
/// rule (`tailnetAddress.ts`), which is the same range.
///
/// Loopback (127.0.0.0/8) is allowed only where `allowsLoopback` says so: the default is on in a DEBUG build (the
/// tests talk to a real daemon on 127.0.0.1) and off in a release build.
public enum MachineAddress {
    #if DEBUG
    public static let loopbackAllowedByBuild = true
    #else
    public static let loopbackAllowedByBuild = false
    #endif

    public static func isAllowed(_ url: URL, allowsLoopback: Bool = loopbackAllowedByBuild) -> Bool {
        guard url.scheme?.lowercased() == "http", url.user == nil, url.password == nil else { return false }
        if let port = url.port, !validPorts.contains(port) { return false }
        guard let octets = octets(of: url.host()) else { return false }
        if isTailnet(octets) { return true }
        return allowsLoopback && octets[0] == loopbackFirstOctet
    }

    /// The address itself when it is allowed, else `error` (the words differ for a link and for a typed address).
    public static func require(
        _ url: URL, allowsLoopback: Bool = loopbackAllowedByBuild, otherwise error: MachineAddressError
    ) throws -> URL {
        guard isAllowed(url, allowsLoopback: allowsLoopback) else { throw error }
        return url
    }

    private static let validPorts = 1...65_535
    private static let tailnetFirstOctet = 100
    private static let tailnetSecondOctets = 64...127
    private static let loopbackFirstOctet = 127

    private static func isTailnet(_ octets: [Int]) -> Bool {
        octets[0] == tailnetFirstOctet && tailnetSecondOctets.contains(octets[1])
    }

    /// The four numbers of a dotted IPv4 address, or nil for anything else (host name, IPv6, short or hex forms,
    /// leading zeros).
    private static func octets(of host: String?) -> [Int]? {
        guard let host else { return nil }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let numbers = parts.compactMap { part -> Int? in
            guard (1...3).contains(part.count), part.allSatisfy(\.isASCII), part.allSatisfy(\.isNumber) else { return nil }
            guard part == "0" || !part.hasPrefix("0") else { return nil }
            return Int(part).flatMap { $0 <= 255 ? $0 : nil }
        }
        return numbers.count == 4 ? numbers : nil
    }
}
