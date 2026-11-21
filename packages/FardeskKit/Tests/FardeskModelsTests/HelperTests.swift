import FardeskModels
import Foundation
import Testing

struct HelperTests {
    private func encoded<T: Encodable>(_ value: T) throws -> String {
        String(decoding: try FardeskJSON.makeEncoder().encode(value), as: UTF8.self)
    }

    @Test func requestInitialisersEncodeTheContractShape() throws {
        #expect(try encoded(MessageRequest(text: "hi")) == #"{"text":"hi"}"#)
        #expect(try encoded(PermissionDecisionRequest(decision: .allowAlways)) == #"{"decision":"allow_always"}"#)
        #expect(try encoded(AnswerRequest(option: "Yes")) == #"{"option":"Yes"}"#)
        #expect(try encoded(MuteRequest(muted: true)) == #"{"muted":true}"#)
        #expect(
            try encoded(NewSessionRequest(cwd: "/tmp", prompt: "p", worktree: true, model: nil))
                == #"{"cwd":"\/tmp","model":null,"prompt":"p","worktree":true}"#.replacingOccurrences(of: #"\/"#, with: "/")
        )
        let device = DeviceRequest(
            apnsToken: String(repeating: "a", count: 64),
            environment: .sandbox,
            name: "iPhone",
            notifications: [.done, .ended]
        )
        #expect(try encoded(device).contains(#""notifications":["done","ended"]"#))
    }

    @Test func activityIdentityComesFromItsPayload() throws {
        let url = FixtureCatalog.fixturesDirectory.appending(path: "ActivityPage/everyActivityKind.json")
        let page = try FardeskJSON.makeDecoder().decode(ActivityPage.self, from: Data(contentsOf: url))
        #expect(page.items.count == 18)
        #expect(Set(page.items.map(\.id)).count == 18)
    }

    @Test func timestampsKeepMillisecondPrecisionAsUTC() throws {
        let json = #"{"type":"ping","ts":"2026-11-14T09:12:30.123Z"}"#
        let event = try FardeskJSON.makeDecoder().decode(StreamEvent.self, from: Data(json.utf8))
        #expect(try encoded(event) == #"{"ts":"2026-11-14T09:12:30.123Z","type":"ping"}"#)
    }
}
