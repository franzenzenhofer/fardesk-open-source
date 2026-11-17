import Foundation

extension URL {
    /// Same scheme, host and port: the hub's address and a pairing link for it name one daemon.
    public func sameOrigin(as other: URL) -> Bool {
        scheme == other.scheme && host() == other.host() && port == other.port
    }
}
