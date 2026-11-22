import FardeskClient
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation

/// Pairing links built the way `fardeskd pair` builds them: a real one-time code minted by the daemon.
public enum PairingLinks {
    /// A fresh single-use code from the daemon (`POST /v1/auth/pair-code`, authorised by the config token).
    public static func mintCode(url: URL, ) async throws -> String {
        var request = URLRequest(url: url.appending(path: "v1/auth/pair-code"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(TestDaemon.token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await FardeskSessions.http.data(for: request)
        return try FardeskJSON.makeDecoder().decode(PairCodeResult.self, from: data).code
    }

    /// A pairing link for `url` carrying `code`.
    public static func make(url: URL, name: String, code: String, hub: Bool = false) throws -> String {
        let json: [String: Any] = ["v": 4, "name": name, "url": url.absoluteString, "code": code, "hub": hub]
        let payload = try FardeskJSON.makeDecoder().decode(PairingPayload.self, from: JSONSerialization.data(withJSONObject: json))
        return try PairingLink.make(payload)
    }

    /// A link for a running daemon with a freshly minted code.
    public static func make(for daemon: TestDaemon, name: String, hub: Bool = false) async throws -> String {
        let code = try await mintCode(url: daemon.url)
        return try make(url: daemon.url, name: name, code: code, hub: hub)
    }
}
