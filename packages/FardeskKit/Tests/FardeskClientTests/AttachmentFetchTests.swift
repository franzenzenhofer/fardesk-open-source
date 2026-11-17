@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

struct AttachmentFetchTests {
    @Test func fetchesTheStoredBytesByPathAndRefusesAnyOtherPath() async throws {
        try await TestDaemon.with { daemon in
            let api = apiFor(daemon)
            let bytes = Data([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE, 0x80])
            let sessionID = SeedSession.editsSessionID
            let stored = try await api.uploadAttachment(sessionID: sessionID, data: bytes, mediaType: "image/png", filename: "shot.png")
            #expect(try await api.attachment(sessionID: sessionID, path: stored.path) == bytes)
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await api.attachment(sessionID: sessionID, path: "/etc/hosts")
            }
            #expect(error.code == .notFound)
        }
    }
}
