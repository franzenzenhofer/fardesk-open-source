import Foundation
import Network

/// One HTTP request as the local test server read it, plus its raw bytes.
public struct LocalHTTPRequest: Sendable {
    public let method: String
    public let path: String
    /// Header names in lower case.
    public let headers: [String: String]
    public let body: Data
    public let raw: Data
}

/// One answer: status line text ("200 OK"), content type and body.
public struct LocalHTTPResponse: Sendable {
    public let status: String
    public let contentType: String
    public let body: Data

    public init(status: String = "200 OK", contentType: String = "application/json", body: Data) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }
}

/// A real HTTP server on a free local port for client tests that need a route the test daemon does not serve:
/// every request is recorded and answered by the handler, one request per connection.
public final class LocalHTTPServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local-http-server")
    private let lock = NSLock()
    private var recorded: [LocalHTTPRequest] = []
    private let handler: @Sendable (LocalHTTPRequest) -> LocalHTTPResponse

    public var port: UInt16 { listener.port?.rawValue ?? 0 }
    public var requests: [LocalHTTPRequest] { lock.withLock { recorded } }

    public init(handler: @escaping @Sendable (LocalHTTPRequest) -> LocalHTTPResponse) throws {
        self.handler = handler
        listener = try NWListener(using: .tcp, on: .any)
    }

    public func start() async throws {
        listener.newConnectionHandler = { [self] connection in
            connection.start(queue: queue)
            receive(on: connection, buffer: Data())
        }
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            let once = ResumeOnce(done)
            listener.stateUpdateHandler = { state in
                if case .ready = state { once.resume(nil) }
                if case .failed(let error) = state { once.resume(error) }
            }
            listener.start(queue: queue)
        }
    }

    public func stop() { listener.cancel() }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 22) { [self] data, _, finished, _ in
            let all = buffer + (data ?? Data())
            if let request = Self.parse(all) {
                respond(to: request, on: connection)
            } else if finished {
                connection.cancel()
            } else {
                receive(on: connection, buffer: all)
            }
        }
    }

    private func respond(to request: LocalHTTPRequest, on connection: NWConnection) {
        lock.withLock { recorded.append(request) }
        let answer = handler(request)
        let head = "HTTP/1.1 \(answer.status)\r\nContent-Type: \(answer.contentType)\r\n"
            + "Content-Length: \(answer.body.count)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + answer.body, completion: .contentProcessed { _ in connection.cancel() })
    }

    /// Nil until the head and the whole body (by Content-Length) have arrived.
    static func parse(_ bytes: Data) -> LocalHTTPRequest? {
        guard let end = bytes.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: bytes[..<end.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        let line = head[0].split(separator: " ")
        let headers = Dictionary(head.dropFirst().compactMap { entry -> (String, String)? in
            guard let colon = entry.firstIndex(of: ":") else { return nil }
            return (entry[..<colon].lowercased(), entry[entry.index(after: colon)...].trimmingCharacters(in: .whitespaces))
        }, uniquingKeysWith: { $1 })
        let body = bytes[end.upperBound...]
        guard line.count >= 2, body.count >= Int(headers["content-length"] ?? "0") ?? 0 else { return nil }
        return LocalHTTPRequest(method: String(line[0]), path: String(line[1]), headers: headers, body: Data(body), raw: bytes)
    }
}

/// Resumes a continuation once, from whichever listener state comes first.
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?

    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }

    func resume(_ error: (any Error)?) {
        let taken = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            defer { continuation = nil }
            return continuation
        }
        if let error { taken?.resume(throwing: error) } else { taken?.resume() }
    }
}
