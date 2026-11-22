import FardeskModels
import Foundation
import Testing

/// Tailscale only (#95): one rule, `MachineAddress`, and the entry points that use it in FardeskModels.
enum TailnetAddresses {
    static let ok = ["http://100.64.0.10:4780", "http://100.127.255.254", "http://100.100.1.2:7878/"]
    /// LAN, public, host name, https, other schemes, tricks.
    static let refused = [
        "https://192.168.1.20:4780",
        "https://10.0.0.5:4780",
        "https://172.16.0.1",
        "https://8.8.8.8",
        "http://100.63.255.255",
        "http://100.128.0.1",
        "https://desk.example.com:4780",
        "https://studio.local:4780",
        "https://localhost:4780",
        "http://100.64.0.10.evil.example.com",
        "http://100.64.0.10@evil.example.com",
        "http://100.064.0.10",
        "http://100.64.0",
        "https://[fd7a:115c:a1e0::1]:4780",
        "https://100.64.0.10:4780", "https://100.127.255.254",
        "ftp://100.64.0.10",
    ]
    static let loopback = ["http://127.0.0.1:4780", "http://127.5.5.5"]
}

struct TailnetAddressTests {
    @Test(arguments: TailnetAddresses.ok)
    func aTailnetAddressIsAllowed(text: String) throws {
        let url = try #require(URL(string: text))
        #expect(MachineAddress.isAllowed(url, allowsLoopback: false))
    }

    @Test(arguments: TailnetAddresses.refused + TailnetAddresses.loopback)
    func everythingElseIsRefusedInARelease(text: String) throws {
        let url = try #require(URL(string: text))
        #expect(!MachineAddress.isAllowed(url, allowsLoopback: false))
    }

    @Test(arguments: TailnetAddresses.refused)
    func evenWithTheTestFlagOnlyLoopbackIsAddedToTheTailnet(text: String) throws {
        let url = try #require(URL(string: text))
        #expect(!MachineAddress.isAllowed(url, allowsLoopback: true))
    }

    @Test(arguments: TailnetAddresses.loopback)
    func loopbackIsAllowedOnlyUnderTheTestFlag(text: String) throws {
        let url = try #require(URL(string: text))
        #expect(MachineAddress.isAllowed(url, allowsLoopback: true))
        #expect(throws: MachineAddressError.address) { try MachineAddress.require(url, allowsLoopback: false, otherwise: .address) }
    }

    @Test func theRefusalSaysSoInPlainWords() {
        #expect(MachineAddressError.link.errorDescription == "Fardesk only connects inside your tailnet; this link points elsewhere.")
        #expect(MachineAddressError.address.errorDescription == "Fardesk only connects inside your tailnet; this address points elsewhere.")
    }
}

struct TailnetPayloadAndHubSettingTests {
    private let code = String(repeating: "c", count: 32)

    private func payload(_ url: String) -> Data {
        Data(#"{"v":3,"name":"n","url":"\#(url)","code":"\#(code)","hub":false}"#.utf8)
    }

    private func hub(_ url: String) -> Data {
        Data(#"{"url":"\#(url)"}"#.utf8)
    }

    @Test(arguments: TailnetAddresses.ok)
    func aPairingPayloadOnATailnetAddressDecodes(text: String) throws {
        #expect(try FardeskJSON.makeDecoder().decode(PairingPayload.self, from: payload(text)).url.absoluteString == text)
    }

    @Test(arguments: ["http://192.168.1.20:4780", "http://8.8.8.8", "http://desk.example.com:4780", "http://studio.local"])
    func aPairingPayloadOutsideTheTailnetIsRefused(text: String) {
        #expect(throws: MachineAddressError.link) { try FardeskJSON.makeDecoder().decode(PairingPayload.self, from: payload(text)) }
    }

    @Test(arguments: TailnetAddresses.ok)
    func aHubSettingOnATailnetAddressDecodes(text: String) throws {
        #expect(try FardeskJSON.makeDecoder().decode(HubLink.self, from: hub(text)).url.absoluteString == text)
    }

    @Test(arguments: ["https://192.168.1.20:4780", "https://8.8.8.8", "https://desk.example.com:4780", "https://100.64.0.10:4780"])
    func aHubSettingOutsideTheTailnetIsRefused(text: String) {
        #expect(throws: MachineAddressError.address) { try FardeskJSON.makeDecoder().decode(HubLink.self, from: hub(text)) }
    }
}
