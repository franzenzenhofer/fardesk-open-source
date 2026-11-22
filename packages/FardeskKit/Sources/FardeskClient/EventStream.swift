import FardeskModels
import Foundation
import Synchronization

/// One WebSocket connection to `/v1/stream`, exposed as an async sequence of contract events.
/// It ends with an error when the connection fails; reconnecting is `ReconnectingStream`'s job.
public struct EventStream: Sendable {
    public static let defaultIdleTimeout: TimeInterval = 90

    private let api: FardeskAPI
    private let session: URLSession
    private let idleTimeout: TimeInterval

    public init(api: FardeskAPI, idleTimeout: TimeInterval = defaultIdleTimeout) {
        self.api = api
        session = FardeskSessions.stream
        self.idleTimeout = idleTimeout
    }

    public func events() -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = session.webSocketTask(with: makeRequest())
            let heard = Heartbeat()
            task.resume()
            let watchdog = Task { await watch(task, heard: heard) }
            let reader = Task {
                do {
                    while true {
                        let event = try decode(try await task.receive())
                        heard.touch()
                        continuation.yield(event)
                    }
                } catch {
                    continuation.finish(throwing: await classify(error, task: task))
                }
            }
            continuation.onTermination = { _ in
                watchdog.cancel()
                reader.cancel()
                task.cancel(with: .goingAway, reason: nil)
            }
        }
    }

    func makeRequest() -> URLRequest {
        var components = URLComponents(url: api.baseURL, resolvingAgainstBaseURL: false)
        components?.scheme = "ws"
        components?.percentEncodedPath = api.pathPrefix + "/v1/stream"
        var request = URLRequest(url: components?.url ?? api.baseURL, timeoutInterval: max(api.timeout, FardeskSessions.streamTimeout))
        if let token = api.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private func decode(_ message: URLSessionWebSocketTask.Message) throws -> StreamEvent {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let binary): data = binary
        @unknown default: throw FardeskAPIError.decoding("unknown WebSocket message type")
        }
        do {
            return try FardeskJSON.makeDecoder().decode(StreamEvent.self, from: data)
        } catch {
            throw FardeskAPIError.decoding(String(describing: error))
        }
    }

    /// A refused upgrade carries no body: ask over HTTP so the caller learns `token_revoked`
    /// versus `unauthorized`.
    private func classify(_ error: any Error, task: URLSessionWebSocketTask) async -> any Error {
        if (task.response as? HTTPURLResponse)?.statusCode == 401 { return await rejection() }
        if let apiError = error as? FardeskAPIError { return apiError }
        if let urlError = error as? URLError {
            return FardeskAPIError.transport(urlError)
        }
        return error
    }

    private func rejection() async -> any Error {
        do {
            _ = try await api.machine()
            return FardeskAPIError.transport(URLError(.userAuthenticationRequired))
        } catch {
            return error
        }
    }

    private func watch(_ task: URLSessionWebSocketTask, heard: Heartbeat) async {
        let step = Duration.seconds(max(1, idleTimeout / 4))
        while !Task.isCancelled {
            try? await Task.sleep(for: step)
            guard !Task.isCancelled else { return }
            if heard.age > idleTimeout {
                task.cancel(with: .abnormalClosure, reason: nil)
                return
            }
        }
    }
}

/// When the connection last delivered an event, readable from any task.
final class Heartbeat: Sendable {
    private let last = Mutex(Date())

    func touch() { last.withLock { $0 = Date() } }

    var age: TimeInterval { Date().timeIntervalSince(last.withLock { $0 }) }
}
