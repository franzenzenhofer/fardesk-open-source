@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

func apiFor(_ daemon: TestDaemon, token: String? = TestDaemon.token) -> FardeskAPI {
    FardeskAPI(baseURL: daemon.url, token: token, timeout: 5)
}

struct FardeskAPIReadTests {
    @Test func readsMachineSessionsActivityDetailAndFolders() async throws {
        try await TestDaemon.with { daemon in
            let api = apiFor(daemon)
            let machine = try await api.machine()
            #expect(machine.name == "test-box")

            let sessions = try await api.sessions()
            #expect(Set(sessions.map(\.id)) == Set(SeedSession.standard.map(\.id)))
            #expect(machine.sessionsCount == sessions.count)

            let page = try await api.activity(sessionID: SeedSession.editsSessionID, limit: 3)
            #expect(page.items.count == 3)
            let older = try await api.activity(sessionID: SeedSession.editsSessionID, before: page.nextBefore, limit: 3)
            #expect(Set(older.items.map(\.id)).isDisjoint(with: page.items.map(\.id)))

            let full = try await api.activity(sessionID: SeedSession.editsSessionID, limit: 200)
            let withDetail = full.items.compactMap { item -> String? in
                if case .tool(let tool) = item, tool.hasDetail { return tool.id }
                return nil
            }
            let detail = try await api.detail(sessionID: SeedSession.editsSessionID, activityID: try #require(withDetail.first))
            #expect(!detail.sections.isEmpty)

            let folders = try await api.recentFolders()
            #expect(folders.folders.count >= 0)
        }
    }

    @Test func unknownSessionIsAServerErrorWithTheContractCode() async throws {
        try await TestDaemon.with { daemon in
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await apiFor(daemon).activity(sessionID: "does-not-exist")
            }
            #expect(error.code == .notFound)
            #expect(error.status == 404)
        }
    }

    @Test func wrongTokenIsUnauthorized() async throws {
        try await TestDaemon.with { daemon in
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await apiFor(daemon, token: "nope").machine()
            }
            #expect(error.code == .unauthorized)
            #expect(!error.isTokenRevoked)
            #expect(error.errorDescription?.isEmpty == false)
        }
    }

    @Test func invalidRequestComesBackAsInvalidRequest() async throws {
        try await TestDaemon.with { daemon in
            let request = NewSessionRequest(cwd: "/definitely/not/here", prompt: "hi", worktree: false, model: nil)
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await apiFor(daemon).newSession(request)
            }
            #expect(error.code == .invalidRequest)
        }
    }

    @Test func unreachableMachineIsATransportError() async throws {
        let api = FardeskAPI(baseURL: URL(string: "http://127.0.0.1:9")!, token: "t", timeout: 2)
        let error = try await #require(throws: FardeskAPIError.self) { _ = try await api.machine() }
        #expect(error.isTransport)
        #expect(error.code == nil && !error.isTokenRevoked)
        #expect(error.errorDescription?.isEmpty == false)
    }

    @Test func nonContractAnswerIsADecodingError() async throws {
        try await TestDaemon.with { daemon in
            let wrongShape = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await wrongShape.send(APIRequest(method: .get, segments: ["v1", "sessions"]), as: AuthDeviceList.self)
            }
            #expect(error.isDecoding)
            #expect(error.errorDescription?.contains("Unexpected answer") == true)
        }
    }

    @Test func tokenRevokedHelperLooksAtTheContractCode() throws {
        let body = Data(#"{"error":{"code":"token_revoked","message":"revoked"}}"#.utf8)
        let response = try FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: body)
        let error: any Error = FardeskAPIError.server(status: 401, response: response)
        #expect(error.isTokenRevoked)
        #expect(!(URLError(.timedOut) as any Error).isTokenRevoked)
    }
}

extension FardeskAPIError {
    var isTransport: Bool { if case .transport = self { true } else { false } }
    var isDecoding: Bool { if case .decoding = self { true } else { false } }
    var status: Int? { if case .server(let status, _) = self { status } else { nil } }
}
