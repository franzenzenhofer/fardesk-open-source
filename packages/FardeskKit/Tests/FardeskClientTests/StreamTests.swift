@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

struct BackoffPolicyTests {
    private let policy = BackoffPolicy(initial: 1, maximum: 30, jitter: 0.25)

    @Test func doublesFromOneSecondUpToThirty() {
        let delays = (0..<8).map { policy.delay(attempt: $0, unit: 0.5) }
        #expect(delays == [1, 2, 4, 8, 16, 30, 30, 30])
    }

    @Test func jitterSpreadsAroundTheBaseDelay() {
        #expect(policy.delay(attempt: 2, unit: 0) == 3)
        #expect(policy.delay(attempt: 2, unit: 1) == 5)
        let random = policy.delay(attempt: 2)
        #expect(random >= 3 && random <= 5)
    }

    @Test func extremeInputsStayInBounds() {
        #expect(policy.delay(attempt: -5, unit: 0.5) == 1)
        #expect(policy.delay(attempt: 10_000, unit: 0.5) == 30)
        #expect(policy.delay(attempt: 0, unit: 7) == 1.25)
        #expect(BackoffPolicy.standard == policy)
    }
}

struct EventStreamTests {
    @Test func helloFirstThenLiveActivity() async throws {
        try await TestDaemon.with { daemon in
            var events = EventStream(api: apiFor(daemon)).events().makeAsyncIterator()
            guard case .hello(let machine, let sessions) = try await events.next() else {
                return #expect(Bool(false), "first event must be hello")
            }
            #expect(machine.name == "test-box")
            #expect(sessions.count == SeedSession.standard.count)

            try daemon.appendUserPrompt("hello from the test", toSession: SeedSession.hookSessionID)
            var seen = false
            while !seen, let event = try await events.next() {
                if case .activity(let id, .user(let user)) = event, id == SeedSession.hookSessionID {
                    seen = user.text == "hello from the test"
                }
            }
            #expect(seen)
        }
    }

    @Test func badTokenEndsWithTheContractError() async throws {
        try await TestDaemon.with { daemon in
            let stream = EventStream(api: apiFor(daemon, token: "wrong")).events()
            let error = try await #require(throws: FardeskAPIError.self) {
                for try await _ in stream {}
            }
            #expect(error.code == .unauthorized)
        }
    }

    @Test func unreachableMachineEndsWithATransportError() async throws {
        let api = FardeskAPI(baseURL: URL(string: "http://127.0.0.1:9")!, token: "t", timeout: 2)
        let error = try await #require(throws: FardeskAPIError.self) {
            for try await _ in EventStream(api: api).events() {}
        }
        #expect(error.isTransport)
    }
}

struct ReconnectingStreamTests {
    private let fast = BackoffPolicy(initial: 0.05, maximum: 0.2, jitter: 0)

    @Test func reconnectsAfterTheDaemonIsRestartedAndReportsStates() async throws {
        try await TestDaemon.with { daemon in
            let stream = ReconnectingStream(api: apiFor(daemon), policy: fast).updates()
            var updates = stream.makeAsyncIterator()
            #expect(try await updates.next() == .connecting)
            try await skipUntil(&updates) { $0 == .connected }

            await daemon.stopServer()
            try await skipUntil(&updates) { if case .disconnected = $0 { true } else { false } }
            try await daemon.launch()

            try await skipUntil(&updates) { $0 == .connected }
            try await skipUntil(&updates) { if case .event(.hello) = $0 { true } else { false } }
        }
    }

    @Test func revokedOrUnauthorizedTokenEndsTheStreamInsteadOfRetrying() async throws {
        try await TestDaemon.with { daemon in
            let stream = ReconnectingStream(api: apiFor(daemon, token: "wrong"), policy: fast).updates()
            let error = try await #require(throws: FardeskAPIError.self) {
                for try await _ in stream {}
            }
            #expect(error.code == .unauthorized)
        }
    }

    @Test func finalErrorsAreRevokedAndUnauthorizedOnly() throws {
        func server(_ code: String) throws -> any Error {
            let body = Data(#"{"error":{"code":"\#(code)","message":"m"}}"#.utf8)
            return FardeskAPIError.server(status: 401, response: try FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: body))
        }
        #expect(ReconnectingStream.isFinal(try server("token_revoked")))
        #expect(ReconnectingStream.isFinal(try server("unauthorized")))
        #expect(!ReconnectingStream.isFinal(try server("internal")))
        #expect(!ReconnectingStream.isFinal(FardeskAPIError.transport(URLError(.timedOut))))
        #expect(!ReconnectingStream.isFinal(CancellationError()))
    }
}

private func skipUntil(
    _ updates: inout AsyncThrowingStream<StreamUpdate, Error>.Iterator,
    timeout: Duration = .seconds(15),
    _ matches: @Sendable (StreamUpdate) -> Bool
) async throws {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline, let update = try await updates.next() {
        if matches(update) { return }
    }
    Issue.record("expected update never arrived")
}
