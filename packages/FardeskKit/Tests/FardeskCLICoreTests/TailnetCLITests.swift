import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

/// Tailscale only (#95), CLI side: `fardesk hub --set` and `fardesk pair` refuse every address outside the tailnet in
/// plain words and write nothing.
struct TailnetCLITests {
    private func link(url: String) -> String {
        let json = #"{"v":3,"name":"n","url":"\#(url)","code":"\#(String(repeating: "c", count: 32))","hub":false}"#
        return PairingLinkText.make(json)
    }

    @Test(arguments: ["http://192.168.1.20:4780", "http://8.8.8.8:4780", "http://desk.example.com:4780"])
    func hubSetRefusesAddressesOutsideTheTailnet(url: String) async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["hub", "--set", url])
        #expect(result.status == 1)
        #expect(
            result.errText.contains("Fardesk only connects inside your tailnet; this address points elsewhere."),
            "\(result.errText)"
        )
        #expect(!FileManager.default.fileExists(atPath: cli.machinesURL.path), "no hub was written")
    }

    @Test func hubSetRefusesHttps() async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["hub", "--set", "https://100.64.0.10:4780"])
        #expect(result.status != 0)
        #expect(result.errText.contains("http://100.64.0.1"), "\(result.errText)")
        #expect(!FileManager.default.fileExists(atPath: cli.machinesURL.path), "no hub was written")
    }

    @Test func hubSetAcceptsATailnetAddress() async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["hub", "--set", "http://100.64.0.10:4780"])
        #expect(result.status == 0, "\(result.errText)")
    }

    @Test(arguments: ["http://192.168.1.20:4780", "http://8.8.8.8:4780", "http://desk.example.com:4780"])
    func pairRefusesALinkOutsideTheTailnet(url: String) async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["pair", link(url: url)])
        #expect(result.status == 1)
        #expect(result.errText.contains("Fardesk only connects inside your tailnet; this link points elsewhere."), "\(result.errText)")
        #expect(!FileManager.default.fileExists(atPath: cli.machinesURL.path), "no machine was written")
    }

    @Test func pairRefusesWithoutATailnetAddressOnThisDevice() async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["pair", link(url: "http://100.64.0.10:4780")], tailscaleIsOn: { false })
        #expect(result.status == 1)
        #expect(result.errText.contains(TailscaleRequirement.offMessage), "\(result.errText)")
        #expect(!FileManager.default.fileExists(atPath: cli.machinesURL.path), "no machine was written")
    }
}

enum PairingLinkText {
    static func make(_ json: String) -> String {
        let encoded = Data(json.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "fardesk://pair?d=" + encoded
    }
}
