import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

struct CoordinatorCommandTests {
    @Test func openWithoutACoordinatorSessionExplainsHowToStartOne() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["coordinator", "--open"])
            #expect(result.status == 1)
            #expect(result.errText.contains("No coordinator session on box yet"))
        }
    }

    @Test func textAndOpenTogetherOrNeitherIsAUsageError() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            #expect(await cli.run(["coordinator"]).status == 64)
            #expect(await cli.run(["ask", "--open", "hello"]).status == 64)
        }
    }

    @Test func aNonPositiveTimeoutIsAUsageError() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            #expect(await cli.run(["coordinator", "--timeout", "0", "hello"]).status == 64)
        }
    }

    @Test func askStartsTheCoordinatorAndOpenNamesTheSameSession() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            #expect(try await api.coordinatorState().sessionId == nil)

            let result = await cli.run(["ask", "--machine", "bo", "What needs me?"])
            let sessionID = try #require(try await api.coordinatorState().sessionId)
            #expect(result.out.first == "Coordinator on box: \(shortID(sessionID))", "\(result.errText)")

            let json = await cli.run(["coordinator", "--open", "--json"])
            #expect(json.out.first?.contains("\"sessionId\":\"\(sessionID)\"") == true)
        }
    }
}
