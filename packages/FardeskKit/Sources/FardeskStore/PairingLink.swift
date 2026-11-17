import FardeskModels
import Foundation

public enum PairingError: Error, Equatable, Sendable, LocalizedError {
    case notAFardeskLink
    case missingPayload
    case invalidBase64
    case invalidPayload

    public var errorDescription: String? {
        switch self {
        case .notAFardeskLink: "Not a Fardesk pairing link (expected fardesk://pair?d=...)"
        case .missingPayload: "The pairing link has no payload (d=...)"
        case .invalidBase64: "The pairing payload is not valid base64url"
        case .invalidPayload: "The pairing payload is not a valid Fardesk pairing"
        }
    }
}

/// `fardesk://pair?d=<base64url(JSON PairingPayload, no padding)>`
public enum PairingLink {
    private static let scheme = "fardesk"
    private static let host = "pair"
    private static let queryName = "d"

    public static func parse(_ text: String) throws -> PairingPayload {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              components.scheme == scheme, components.host == host
        else { throw PairingError.notAFardeskLink }
        let encoded = components.queryItems?.first { $0.name == queryName }?.value ?? ""
        guard !encoded.isEmpty else { throw PairingError.missingPayload }
        guard let data = Base64URL.decode(encoded) else { throw PairingError.invalidBase64 }
        guard let payload = try? FardeskJSON.makeDecoder().decode(PairingPayload.self, from: data) else {
            throw PairingError.invalidPayload
        }
        return payload
    }

    public static func make(_ payload: PairingPayload) throws -> String {
        let json = try FardeskJSON.makeEncoder().encode(payload)
        return "\(scheme)://\(host)?\(queryName)=\(Base64URL.encode(json))"
    }
}

enum Base64URL {
    static func decode(_ text: String) -> Data? {
        var standard = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = standard.count % 4
        if remainder > 0 { standard += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: standard)
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
