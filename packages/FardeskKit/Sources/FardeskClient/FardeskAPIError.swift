import FardeskModels
import Foundation

public enum FardeskAPIError: Error, Sendable, LocalizedError {
    /// The daemon answered with a contract `ErrorResponse`.
    case server(status: Int, response: ErrorResponse)
    /// The machine could not be reached (timeout, refused, offline).
    case transport(URLError)
    /// The address is not http inside the tailnet: Fardesk only connects there.
    case insecureAddress(URL)
    /// The answer was not the JSON the contract promises.
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .server(_, let response) where response.error.code == .tailscaleUnavailable: Self.tailscaleUnavailableNotice
        case .server(_, let response): response.error.message
        case .transport(let error): error.localizedDescription
        case .insecureAddress(let url): "\(url.absoluteString) is not an http address inside your tailnet: Fardesk only connects there."
        case .decoding(let detail): "Unexpected answer from the machine: \(detail)"
        }
    }

    /// The contract error code when the daemon answered with one.
    public var code: ErrorCode? {
        guard case .server(_, let response) = self else { return nil }
        return response.error.code
    }

    /// The token was revoked on a daemon: the client must wipe everything local.
    public var isTokenRevoked: Bool { code == .tokenRevoked }

    /// The token is bound to the Tailscale node the device paired from, and this call came from another one: pair again.
    public var isDeviceMoved: Bool { code == .deviceMoved }

    /// What the app says when the daemon could not ask its Tailscale who is calling.
    public static let tailscaleUnavailableNotice = "Tailscale on that computer is not running"
    static let deviceMovedFallback = "This device was paired from another Tailscale device. Pair again."
}

extension Error {
    /// True when any `FardeskAPIError` in this error says the token was revoked.
    public var isTokenRevoked: Bool { (self as? FardeskAPIError)?.isTokenRevoked ?? false }

    /// True when any `FardeskAPIError` in this error says the device was paired from another Tailscale node.
    public var isDeviceMoved: Bool { (self as? FardeskAPIError)?.isDeviceMoved ?? false }

    /// The daemon's own words for a moved device ("... Pair again.").
    public var deviceMovedMessage: String { (self as? FardeskAPIError)?.errorDescription ?? FardeskAPIError.deviceMovedFallback }
}
