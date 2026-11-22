import FardeskModels
import Foundation
import Testing

struct HubModelTests {
    private let hubJSON = """
    {"hub":"Linux","checkedAt":"2026-11-16T09:30:00.000Z","machines":[
      {"name":"Linux","online":true,"hub":true,"lastSeen":"2026-11-16T09:29:59.000Z","latencyMs":1,"problem":null,"detail":null,"sessions":2,"waiting":1,"working":0},
      {"name":"Mac mini Pro","online":false,"hub":false,"lastSeen":null,"latencyMs":null,"problem":"Tailscale is stopped on it","detail":"cannot connect (EHOSTUNREACH)","sessions":0,"waiting":0,"working":0}
    ]}
    """

    @Test func hubStateDecodesAndEncodesBackToTheSameDocument() throws {
        let data = Data(hubJSON.utf8)
        let state = try FardeskJSON.makeDecoder().decode(HubState.self, from: data)
        #expect(state.hub == "Linux")
        #expect(state.machines.map(\.name) == ["Linux", "Mac mini Pro"])
        #expect(state.machines[0].hub && state.machines[0].online)
        #expect(state.machines[1].problem == "Tailscale is stopped on it")
        #expect(state.machines[1].lastSeen == nil)
        let again = try FardeskJSON.makeEncoder().encode(state)
        #expect(try canonicalJSON(again) == canonicalJSON(data))
    }

    @Test func hubStateWithoutRequiredKeysFails() {
        let broken = Data(#"{"hub":"x","checkedAt":"2026-11-16T09:30:00.000Z","machines":[{"name":"a","online":true}]}"#.utf8)
        #expect(throws: DecodingError.self) { _ = try FardeskJSON.makeDecoder().decode(HubState.self, from: broken) }
    }

    @Test func permissionModeDecodesKnownAndUnknownValues() throws {
        let decoder = FardeskJSON.makeDecoder()
        let modes = try decoder.decode([PermissionMode].self, from: Data(#"["bypassPermissions","default","auto","fromTheFuture"]"#.utf8))
        #expect(modes == [.bypassPermissions, .default, .auto, .other("fromTheFuture")])
        #expect(modes.map(\.rawValue) == ["bypassPermissions", "default", "auto", "fromTheFuture"])
        #expect(PermissionMode.pickable.first == .bypassPermissions)
        #expect(PermissionMode.default.label == "Ask")
    }

    @Test func errorCodeKnowsMachineOffline() throws {
        let body = Data(#"{"error":{"code":"machine_offline","message":"Mac mini Pro is offline"}}"#.utf8)
        let response = try FardeskJSON.makeDecoder().decode(ErrorResponse.self, from: body)
        #expect(response.error.code == .machineOffline)
    }

    @Test func newSessionRequestSendsTheModeOnlyWhenGiven() throws {
        let plain = try FardeskJSON.makeEncoder().encode(NewSessionRequest(cwd: "/a", prompt: "p", worktree: false, model: nil))
        #expect(!String(decoding: plain, as: UTF8.self).contains("permissionMode"))
        let planned = try FardeskJSON.makeEncoder().encode(
            NewSessionRequest(cwd: "/a", prompt: "p", worktree: false, model: nil, permissionMode: .plan)
        )
        #expect(String(decoding: planned, as: UTF8.self).contains(#""permissionMode":"plan""#))
        let decoded = try FardeskJSON.makeDecoder().decode(NewSessionRequest.self, from: planned)
        #expect(decoded.permissionMode == .plan)
    }

    @Test func notificationStateAndEventReportsRoundTrip() throws {
        let paused = Data(#"{"pausedUntil":"2026-11-16T10:42:00.000Z"}"#.utf8)
        let state = try FardeskJSON.makeDecoder().decode(NotificationState.self, from: paused)
        #expect(state.pausedUntil != nil)
        #expect(try canonicalJSON(FardeskJSON.makeEncoder().encode(state)) == canonicalJSON(paused))
        let resumed = try FardeskJSON.makeDecoder().decode(NotificationState.self, from: Data(#"{"pausedUntil":null}"#.utf8))
        #expect(resumed.pausedUntil == nil)

        let event = TelemetryReport(
            at: Date(), message: "opened", area: "session.open", appVersion: "1", build: "1", platform: "t",
            kind: .event, durationMs: 42
        )
        let wire = try FardeskJSON.makeEncoder().encode(event)
        let back = try FardeskJSON.makeDecoder().decode(TelemetryReport.self, from: wire)
        #expect(back.kind == .event && back.durationMs == 42)
        let old = Data(#"{"id":"a","at":"2026-11-16T09:30:00.000Z","message":"m","area":"a","appVersion":"1","build":"1","platform":"p"}"#.utf8)
        #expect(try FardeskJSON.makeDecoder().decode(TelemetryReport.self, from: old).kind == nil)
    }
}
