import FardeskModels
import Foundation

/// What a `ReconnectingStream` reports: the connection state and the events themselves.
public enum StreamUpdate: Sendable, Equatable {
    case connecting
    case connected
    /// The connection dropped; the next attempt starts after `retryIn` seconds.
    case disconnected(retryIn: TimeInterval)
    case event(StreamEvent)
}

/// Keeps a machine's event stream alive: reconnects with exponential backoff, resets the backoff
/// after a `hello`, and ends with the error when the token is refused (retrying cannot help).
public struct ReconnectingStream: Sendable {
    public typealias Connect = @Sendable () -> AsyncThrowingStream<StreamEvent, Error>

    private let connect: Connect
    private let policy: BackoffPolicy

    public init(policy: BackoffPolicy = .standard, connect: @escaping Connect) {
        self.policy = policy
        self.connect = connect
    }

    public init(api: FardeskAPI, policy: BackoffPolicy = .standard) {
        self.init(policy: policy) { EventStream(api: api).events() }
    }

    /// Error codes after which reconnecting is pointless.
    static func isFinal(_ error: any Error) -> Bool {
        guard let code = (error as? FardeskAPIError)?.code else { return false }
        return code == .tokenRevoked || code == .unauthorized || code == .deviceMoved || code == .masterTokenWrongNode
    }

    public func updates() -> AsyncThrowingStream<StreamUpdate, Error> {
        AsyncThrowingStream { continuation in
            let runner = Task { await run(continuation) }
            continuation.onTermination = { _ in runner.cancel() }
        }
    }

    private func run(_ continuation: AsyncThrowingStream<StreamUpdate, Error>.Continuation) async {
        var attempt = 0
        while !Task.isCancelled {
            continuation.yield(.connecting)
            do {
                for try await event in connect() {
                    if case .hello = event {
                        attempt = 0
                        continuation.yield(.connected)
                    }
                    continuation.yield(.event(event))
                }
            } catch {
                guard !Self.isFinal(error) else { return continuation.finish(throwing: error) }
            }
            let wait = policy.delay(attempt: attempt)
            attempt += 1
            continuation.yield(.disconnected(retryIn: wait))
            try? await Task.sleep(for: .seconds(wait))
        }
        continuation.finish()
    }
}
