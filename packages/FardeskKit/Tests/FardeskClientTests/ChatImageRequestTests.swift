@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

struct ChatImageRequestTests {
    private func withServer(reply: String, _ body: (FardeskAPI, LocalHTTPServer) async throws -> Void) async throws {
        let answer = Data(reply.utf8)
        let server = try LocalHTTPServer { _ in LocalHTTPResponse(body: answer) }
        try await server.start()
        defer { server.stop() }
        let api = FardeskAPI(baseURL: try #require(URL(string: "http://127.0.0.1:\(server.port)")), token: "t0k", timeout: 5)
        try await body(api, server)
    }

    private func text(_ server: LocalHTTPServer) -> String { String(decoding: server.requests.last?.raw ?? Data(), as: UTF8.self) }

    @Test func setImageSendsTheRawBytesWithTheirMediaTypeAndReadsTheHash() async throws {
        try await withServer(reply: #"{"ok":true,"image":"0123456789abcdef"}"#) { api, server in
            let bytes = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
            let result = try await api.setImage(sessionID: "s1", data: bytes, mediaType: "image/jpeg")
            #expect(result.image == "0123456789abcdef")
            let sent = text(server)
            #expect(sent.hasPrefix("POST /v1/sessions/s1/image HTTP/1.1"))
            #expect(sent.lowercased().contains("content-type: image/jpeg"))
            #expect(sent.contains("Bearer t0k"))
            #expect(server.requests.last?.body == bytes)
        }
    }

    @Test func clearImagePostsToTheClearRoute() async throws {
        try await withServer(reply: #"{"ok":true}"#) { api, server in
            try await api.clearImage(sessionID: "s1")
            #expect(text(server).hasPrefix("POST /v1/sessions/s1/image/clear HTTP/1.1"))
        }
    }

    @Test func imageGetsTheBytesOfTheImageRoute() async throws {
        try await withServer(reply: "PNGBYTES") { api, server in
            let data = try await api.image(sessionID: "s1")
            #expect(data == Data("PNGBYTES".utf8))
            #expect(text(server).hasPrefix("GET /v1/sessions/s1/image HTTP/1.1"))
        }
    }
}
