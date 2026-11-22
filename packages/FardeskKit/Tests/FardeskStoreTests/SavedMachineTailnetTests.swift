import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Tailscale only also for what the app has saved and for the one network gate: no entry of the machine list and
/// no API value can make the app ask an address outside the tailnet.
struct SavedMachineTailnetTests {
    private static func listJSON(url: String) -> Data {
        let entry = #"{"id":"11111111-1111-4111-8111-111111111111","name":"Desk","url":"\#(url)"}"#
        return Data(#"{"endpoints":[\#(entry)]}"#.utf8)
    }

    @Test(arguments: ["https://192.168.1.20:4780", "https://desk.example.com:4780", "https://8.8.8.8:4780", "https://100.64.0.10:4780"])
    func aSavedMachineOutsideTheTailnetIsRefusedWhenTheListLoads(url: String) {
        #expect(throws: (any Error).self) { try JSONDecoder().decode(MachineList.self, from: Self.listJSON(url: url)) }
    }

    @Test func aSavedTailnetMachineLoads() throws {
        let list = try JSONDecoder().decode(MachineList.self, from: Self.listJSON(url: "http://100.64.0.10:4780"))
        #expect(list.endpoints.map(\.url.absoluteString) == ["http://100.64.0.10:4780"])
    }

    @Test(arguments: ["https://192.168.1.20:4780", "https://desk.example.com", "http://user:pw@100.64.0.10:4780", "http://100.64.0.10:0", "https://100.64.0.10:4780"])
    func theNetworkGateRefusesAnAddressOutsideTheTailnetBeforeAnyRequest(url: String) async throws {
        let api = FardeskAPI(baseURL: try #require(URL(string: url)), token: "t", timeout: 2)
        let error = try await #require(throws: FardeskAPIError.self) { _ = try await api.machine() }
        guard case .insecureAddress = error else {
            Issue.record("expected insecureAddress, got \(error)")
            return
        }
    }
}
