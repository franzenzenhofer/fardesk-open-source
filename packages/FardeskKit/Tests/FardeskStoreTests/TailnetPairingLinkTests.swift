import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Tailscale only (#95), app side: a pairing link (pasted or scanned, same path) for any address outside the tailnet is
/// refused before anything is exchanged, and the model says so in plain words.
@MainActor
struct TailnetPairingLinkTests {
    private func link(url: String) -> String {
        let json = #"{"v":3,"name":"n","url":"\#(url)","code":"\#(String(repeating: "c", count: 32))","hub":false}"#
        return "fardesk://pair?d=" + Base64URL.encode(Data(json.utf8))
    }

    @Test func aTailnetLinkParses() throws {
        #expect(try PairingLink.parse(link(url: "http://100.64.0.10:4780")).url.host() == "100.64.0.10")
    }

    @Test(arguments: [
        "http://192.168.1.20:4780", "http://8.8.8.8:4780", "http://desk.example.com:4780", "http://studio.local:4780",
    ])
    func aLinkOutsideTheTailnetIsRefused(url: String) {
        #expect(throws: PairingError.outsideTailnet) { try PairingLink.parse(link(url: url)) }
    }

    @Test func httpsIsRefused() {
        #expect(throws: PairingError.self) { try PairingLink.parse(link(url: "https://100.64.0.10:4780")) }
    }

    @Test func pairingIsRefusedInPlainWordsWhenTailscaleIsOff() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration(tailscaleIsOn: { false }))
            await model.start()
            await model.pair(link: link(url: "http://100.64.0.10:4780"))
            #expect(model.phase != .ready)
            #expect(model.machines.endpoints.isEmpty)
            #expect(model.loginError == TailscaleRequirement.offMessage)
            model.stop()
        }
    }

    @Test func theModelSaysWhyAndStoresNothing() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            await model.pair(link: link(url: "http://192.168.1.20:4780"))
            #expect(model.phase != .ready)
            #expect(model.machines.endpoints.isEmpty)
            #expect(model.loginError?.contains("Fardesk only connects inside your tailnet; this link points elsewhere.") == true)
            model.stop()
        }
    }
}
