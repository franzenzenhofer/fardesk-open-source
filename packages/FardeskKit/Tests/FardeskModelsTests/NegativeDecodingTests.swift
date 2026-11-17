import FardeskModels
import Foundation
import Testing

struct NegativeDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try FardeskJSON.makeDecoder().decode(type, from: Data(json.utf8))
    }

    private let userActivity = #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","kind":"user","text":"hi"}"#

    @Test func validActivityDecodes() throws {
        #expect(try decode(Activity.self, userActivity).id == "a")
    }

    @Test func unknownActivityKindThrows() {
        #expect(throws: DecodingError.self) {
            try decode(Activity.self, #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","kind":"hologram","text":"x"}"#)
        }
    }

    @Test func missingKindThrows() {
        #expect(throws: DecodingError.self) {
            try decode(Activity.self, #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","text":"x"}"#)
        }
    }

    @Test func missingRequiredKeyThrows() {
        #expect(throws: DecodingError.self) {
            try decode(Activity.self, #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","kind":"user"}"#)
        }
    }

    @Test func wrongTypeThrows() {
        #expect(throws: DecodingError.self) {
            try decode(Activity.self, #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","kind":"user","text":5}"#)
        }
    }

    @Test func unknownEnumValueThrows() {
        #expect(throws: DecodingError.self) { try decode(MuteRequest.self, #"{"muted":"yes"}"#) }
        #expect(throws: DecodingError.self) { try decode(PermissionDecisionRequest.self, #"{"decision":"maybe"}"#) }
        #expect(throws: DecodingError.self) { try decode(ErrorResponse.self, #"{"error":{"code":"teapot","message":"m"}}"#) }
    }

    @Test func nullableKeyMustBePresent() {
        let missingModel = #"{"cwd":"/tmp","prompt":"p","worktree":false}"#
        #expect(throws: DecodingError.self) { try decode(NewSessionRequest.self, missingModel) }
    }

    @Test func nullableKeyAcceptsExplicitNullAndEncodesItBack() throws {
        let request = try decode(NewSessionRequest.self, #"{"cwd":"/tmp","prompt":"p","worktree":false,"model":null}"#)
        let json = try String(decoding: FardeskJSON.makeEncoder().encode(request), as: UTF8.self)
        #expect(json.contains(#""model":null"#))
    }

    @Test func unsupportedContractVersionThrows() {
        #expect(throws: DecodingError.self) {
            try decode(PairingPayload.self, #"{"v":2,"name":"n","url":"http://h:1","token":"t"}"#)
        }
    }

    @Test func okResultMustBeTrue() throws {
        #expect(throws: DecodingError.self) { try decode(OkResult.self, #"{"ok":false}"#) }
        #expect(throws: Never.self) { try decode(OkResult.self, #"{"ok":true}"#) }
    }

    @Test func messageResultMustBeOkAndQueuedDefaultsToFalse() throws {
        #expect(throws: DecodingError.self) { try decode(MessageResult.self, #"{"ok":false}"#) }
        #expect(try !decode(MessageResult.self, #"{"ok":true}"#).isQueued)
        #expect(try decode(MessageResult.self, #"{"ok":true,"queued":true}"#).isQueued)
    }

    @Test func unknownStreamEventTypeThrows() {
        #expect(throws: DecodingError.self) { try decode(StreamEvent.self, #"{"type":"explode"}"#) }
    }

    @Test func malformedTimestampThrows() {
        #expect(throws: (any Error).self) { try decode(StreamEvent.self, #"{"type":"ping","ts":"yesterday"}"#) }
    }
}
