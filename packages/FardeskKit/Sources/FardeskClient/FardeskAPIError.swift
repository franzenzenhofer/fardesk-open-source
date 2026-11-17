import FardeskModels
import Foundation

public enum FardeskAPIError: Error, Sendable, LocalizedError {
    /// The daemon answered with a contract `ErrorResponse`.
    case server(status: Int, response: ErrorResponse)
    /// The machine could not be reached (timeout, refused, offline, TLS).
    case transport(URLError)
    /// The answer was not the JSON the contract promises.
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .server(_, let response): response.error.message
        case .transport(let error): error.localizedDescription
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
}

extension Error {
    /// True when any `FardeskAPIError` in this error says the token was revoked.
    public var isTokenRevoked: Bool { (self as? FardeskAPIError)?.isTokenRevoked ?? false }
}
