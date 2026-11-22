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
    @Test func theLinkCarriesCodeAndTheHubFlag() throws {
        let payload = try PairingLink.parse(link(#"{"v":3,"name":"Hub","url":"http://100.64.0.1:4780","code":"\#(code)","hub":true}"#))
        #expect(payload.code == code)
        #expect(payload.hub)
    }

    @Test(arguments: [
        #"{"v":3,"name":"Mac","url":"http://100.64.0.2:4780","hub":false}"#,
        #"{"v":3,"name":"Mac","url":"http://100.64.0.2:4780","code":"CODE"}"#,
        #"{"v":3,"name":"Mac","url":"http://100.64.0.2:4780","token":"TOKEN","hub":false}"#,
    ])
    func aLinkWithoutCodeOrHubDoesNotDecode(template: String) {
        let json = template.replacingOccurrences(of: "CODE", with: code)
        #expect(throws: PairingError.invalidPayload) { try PairingLink.parse(link(json)) }
    }

    @Test func theFixtureLinksCarryCodesAndNoToken() throws {
        for name in ["tailnet", "hub"] {
            let payload = try Fixtures.decode(PairingPayload.self, "PairingPayload", name)
            #expect(!payload.code.isEmpty)
            let encoded = try JSONEncoder().encode(payload)
            #expect(!String(decoding: encoded, as: UTF8.self).contains("token"))
        }
    }
}

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct PairingExchangeE2ETests {
    private func payload(for daemon: TestDaemon, code: String) throws -> PairingPayload {
        try PairingLink.parse(link(#"{"v":3,"name":"box","url":"\#(daemon.url.absoluteString)","code":"\#(code)","hub":false}"#))
    }

    @Test func aCodeBecomesADeviceTokenOfItsOwnAndWorksOnce() async throws {
        try await TestDaemon.with { daemon in
            let access = MachineAccess(tokens: scratchTokens())
            let minted = try await PairingLinks.mintCode(url: daemon.url)
            let paired = try payload(for: daemon, code: minted)
            let token = try await PairingExchange.token(for: paired, deviceName: "Test Phone", access: access)
            #expect(token != TestDaemon.token)
            let api = daemon.api(token: token)
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
