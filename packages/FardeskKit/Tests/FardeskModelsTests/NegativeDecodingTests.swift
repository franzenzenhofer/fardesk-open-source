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

    @Test func unknownActivityKindBecomesANeutralLine() throws {
        let activity = try decode(Activity.self, #"{"id":"a","ts":"2026-11-14T09:00:00.000Z","kind":"hologram","text":"x"}"#)
        #expect(activity.id == "a")
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

    @Test func unknownEnumValueDecodesAsUnknownExceptForABool() throws {
        #expect(throws: DecodingError.self) { try decode(MuteRequest.self, #"{"muted":"yes"}"#) }
        #expect(try decode(PermissionDecisionRequest.self, #"{"decision":"maybe"}"#).decision == .unknown)
        #expect(try decode(ErrorResponse.self, #"{"error":{"code":"teapot","message":"m"}}"#).error.code == .unknown)
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

    @Test func aPairingPayloadWithoutCodeOrHubThrows() {
        for json in [
            #"{"v":3,"name":"n","url":"http://100.64.0.10:1","token":"t"}"#,
            #"{"v":3,"name":"n","url":"http://100.64.0.10:1","code":"c","hub":false}"#,
            #"{"v":3,"name":"n","url":"http://100.64.0.10:1","hub":false}"#,
            #"{"v":3,"name":"n","url":"http://100.64.0.10:1","code":"c"}"#,
        ] {
            #expect(throws: DecodingError.self) { try decode(PairingPayload.self, json) }
        }
    }

    private static let goodCode = String(repeating: "c", count: 32)

    private func payload(url: String = "http://100.64.0.10:4780", code: String = goodCode, extra: String = "") -> String {
        #"{"v":3,"name":"n","url":"\#(url)","code":"\#(code)","hub":false\#(extra)}"#
    }

    @Test func aPairingPayloadWithTheMinimumCodeDecodes() throws {
        #expect(try decode(PairingPayload.self, payload()).code.count == 32)
    }

    @Test func aPairingPayloadOverHttpsThrows() {
        for url in ["https://100.64.0.10:4780", "ftp://100.64.0.10", "100.64.0.10:4780", "http://"] {
            #expect(throws: DecodingError.self) { try decode(PairingPayload.self, payload(url: url)) }
        }
    }

    @Test func aPairingPayloadWithAShortCodeThrows() {
        #expect(throws: DecodingError.self) { try decode(PairingPayload.self, payload(code: String(repeating: "c", count: 31))) }
    }

    @Test func aPairingPayloadWithAnUnknownKeyThrows() {
        #expect(throws: DecodingError.self) { try decode(PairingPayload.self, payload(extra: #","token":"t""#)) }
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

    @Test func unknownStreamEventTypeIsIgnored() throws {
        #expect(try decode(StreamEvent.self, #"{"type":"explode"}"#) == .unknown)
    }

    @Test func malformedTimestampThrows() {
        #expect(throws: (any Error).self) { try decode(StreamEvent.self, #"{"type":"ping","ts":"yesterday"}"#) }
    }
}
