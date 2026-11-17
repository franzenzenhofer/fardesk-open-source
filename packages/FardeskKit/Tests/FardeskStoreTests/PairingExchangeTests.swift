import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private func link(_ json: String) -> String {
    "fardesk://pair?d=" + Base64URL.encode(Data(json.utf8))
}

private func scratchTokens() -> TokenStore {
    .file(url: FileManager.default.temporaryDirectory.appending(path: "pairing-\(UUID().uuidString).json"))
}

private let code = "Zk3vQ9mT2xLp7WcR5nYb8HdJ4sGfA1uEoIq6VtXzNaM"

struct PairingPayloadFormatTests {
    @Test func theNewLinkCarriesACodeAndTheHubFlag() throws {
        let payload = try PairingLink.parse(link(#"{"v":1,"name":"Hub","url":"http://100.64.0.1:4780","code":"\#(code)","hub":true}"#))
        #expect(payload.code == code)
        #expect(payload.token == nil)
        #expect(payload.hub)
    }

    @Test func anOldLinkWithATokenStillParsesAndIsNoHub() throws {
        let token = String(repeating: "ab", count: 32)
        let payload = try PairingLink.parse(link(#"{"v":1,"name":"Mac","url":"http://100.64.0.2:4780","token":"\#(token)"}"#))
        #expect(payload.token == token)
        #expect(payload.code == nil)
        #expect(!payload.hub)
    }

    @Test func aLinkWithNeitherCodeNorTokenIsInvalid() {
        #expect(throws: PairingError.invalidPayload) {
            try PairingLink.parse(link(#"{"v":1,"name":"Mac","url":"http://100.64.0.2:4780","hub":false}"#))
        }
    }

    @Test func theFixtureLinksCarryCodesAndNoToken() throws {
        for name in ["lan", "tls"] {
            let payload = try Fixtures.decode(PairingPayload.self, "PairingPayload", name)
            #expect(payload.code != nil)
            #expect(payload.token == nil)
        }
    }

    @Test func anOldLinkIsUsedAsItIs() async throws {
        let token = String(repeating: "cd", count: 32)
        let payload = try PairingLink.parse(link(#"{"v":1,"name":"Mac","url":"http://127.0.0.1:9","token":"\#(token)"}"#))
        let access = MachineAccess(tokens: scratchTokens())
        #expect(try await PairingExchange.token(for: payload, deviceName: "Test", access: access) == token)
    }
}

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct PairingExchangeE2ETests {
    private func mintCode(daemon: TestDaemon) async throws -> String {
        var request = URLRequest(url: daemon.url.appending(path: "v1/auth/pair-code"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(TestDaemon.token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try FardeskJSON.makeDecoder().decode(PairCodeResult.self, from: data).code
    }

    private func payload(for daemon: TestDaemon, code: String) throws -> PairingPayload {
        try PairingLink.parse(link(#"{"v":1,"name":"box","url":"\#(daemon.url.absoluteString)","code":"\#(code)","hub":false}"#))
    }

    @Test func aCodeBecomesADeviceTokenOfItsOwnAndWorksOnce() async throws {
        try await TestDaemon.with { daemon in
            let access = MachineAccess(tokens: scratchTokens())
            let paired = try payload(for: daemon, code: try await mintCode(daemon: daemon))
            let token = try await PairingExchange.token(for: paired, deviceName: "Test Phone", access: access)
            #expect(token != TestDaemon.token)
            let api = FardeskAPI(baseURL: daemon.url, token: token)
            #expect(try await api.machine().name == "test-box")
            #expect(try await api.authDevices().devices.contains { $0.name == "Test Phone" && $0.current })
            await #expect(throws: (any Error).self) {
                try await PairingExchange.token(for: paired, deviceName: "Again", access: access)
            }
        }
    }

    @Test func aWrongCodeIsRefused() async throws {
        try await TestDaemon.with { daemon in
            let wrong = try payload(for: daemon, code: String(repeating: "x", count: 43))
            await #expect(throws: (any Error).self) {
                try await PairingExchange.token(for: wrong, deviceName: "Test", access: MachineAccess(tokens: scratchTokens()))
            }
        }
    }
}
