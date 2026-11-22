import FardeskTestDaemon
import Foundation

/// A real local HTTP server that plays the three lifeline routes of one machine (docs/VERSIONING.md, section 5):
/// `GET /v1/machine`, `GET /v1/update/package`, `POST /v1/machine/update`. After an install it reports the new
/// version, or a failed update, like a daemon that restarted. Every request is recorded.
final class UpdateServer: @unchecked Sendable {
    enum Outcome: Sendable {
        case becomesNewer(String)
        case fails(String)
        case refuses
    }

    struct Posted: Sendable {
        let body: Data
        let sha256: String?
        let contentType: String?
    }

    private var server: LocalHTTPServer!
    private let lock = NSLock()
    private var version: String
    private var failure: String?
    private let package: Data
    private let outcome: Outcome
    private var posts: [Posted] = []

    var port: UInt16 { server.port }
    var posted: [Posted] { lock.withLock { posts } }
    var requestedPaths: [String] { server.requests.map { "\($0.method) \($0.path)" } }

    init(version: String, package: Data = Data(), outcome: Outcome = .refuses) throws {
        self.version = version
        self.package = package
        self.outcome = outcome
        server = try LocalHTTPServer { [unowned self] request in self.answer(request) }
    }

    func start() async throws { try await server.start() }

    func stop() { server.stop() }

    private func answer(_ request: LocalHTTPRequest) -> LocalHTTPResponse {
        switch (request.method, request.path) {
        case ("GET", "/v1/machine"): return LocalHTTPResponse(body: machineJSON())
        case ("GET", "/v1/update/package"): return LocalHTTPResponse(contentType: "application/gzip", body: package)
        case ("POST", "/v1/machine/update"): return install(request)
        default: return LocalHTTPResponse(status: "404 Not Found", body: Data(#"{"error":{"code":"not_found","message":"no route"}}"#.utf8))
        }
    }

    private func install(_ request: LocalHTTPRequest) -> LocalHTTPResponse {
        let posted = Posted(body: request.body, sha256: request.headers["x-fardesk-package-sha256"], contentType: request.headers["content-type"])
        lock.withLock { posts.append(posted) }
        switch outcome {
        case .becomesNewer(let next): lock.withLock { version = next }
        case .fails(let message): lock.withLock { failure = message }
        case .refuses: return LocalHTTPResponse(status: "400 Bad Request", body: Data(#"{"error":{"code":"invalid_request","message":"update refused"}}"#.utf8))
        }
        return LocalHTTPResponse(body: Data(#"{"ok":true,"state":"running"}"#.utf8))
    }

    private func machineJSON() -> Data {
        let (current, failed) = lock.withLock { (version, failure) }
        let update = failed.map { #","update":{"state":"failed","message":"\#($0)"}"# } ?? #","update":{"state":"idle"}"#
        return Data(#"""
        {"contractVersion":4,"name":"Box","hostname":"box.example.com","os":"linux","version":"\#(current)",
         "claudeVersion":null,"sessionsCount":0,"models":[],"ghosttyAutomation":"unknown","allowBypass":true,
         "coordinatorEnabled":false,"homes":["main"],"tailscale":{"state":"running"},"features":["self-update"]\#(update)}
        """#.utf8)
    }
}
