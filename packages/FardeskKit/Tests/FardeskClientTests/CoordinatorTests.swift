@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

struct CoordinatorClientTests {
    @Test func stateIsNullUntilTheCoordinatorIsAsked() async throws {
        try await TestDaemon.with { daemon in
            let api = apiFor(daemon)
            #expect(try await api.coordinatorState().sessionId == nil)

            let asked = try await api.askCoordinator(prompt: "What needs me?")
            #expect(!asked.sessionId.isEmpty)
            #expect(try await api.coordinatorState().sessionId == asked.sessionId)

            let again = try await api.askCoordinator(prompt: "And now?")
            #expect(again.sessionId == asked.sessionId)
        }
    }

    @Test func stateWithoutATokenIsUnauthorized() async throws {
        try await TestDaemon.with { daemon in
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await apiFor(daemon, token: nil).coordinatorState()
            }
            #expect(error.status == 401)
        }
    }
}
