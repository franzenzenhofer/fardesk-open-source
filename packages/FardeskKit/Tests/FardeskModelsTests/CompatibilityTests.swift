import FardeskModels
import Foundation
import Testing

/// docs/VERSIONING.md, section 3: a newer daemon may add keys and enum values; an older app reads on.
struct CompatibilityTests {
    /// Contracts that are strict on purpose: a pairing link is a security input and rejects keys it does not know.
    private static let strictContracts: Set<String> = ["PairingPayload"]

    /// Every key whose value is an enum the daemon sends.
    private static let enumKeys: Set<String> = [
        "status", "waitingFor", "replyMode", "agent", "os", "ghosttyAutomation", "state", "kind", "sign",
        "code", "type", "decision", "closed", "environment", "result",
    ]

    private static let futureValue = "from-the-future"

    private static let decodableFixtures: [Fixture] = ((try? FixtureCatalog.allFixtures()) ?? [])
        .filter { !strictContracts.contains($0.contractName) }

    private func mutated(_ value: Any, _ change: (inout [String: Any]) -> Void) -> Any {
        if var object = value as? [String: Any] {
            object = object.mapValues { mutated($0, change) }
            change(&object)
            return object
        }
        if let array = value as? [Any] { return array.map { mutated($0, change) } }
        return value
    }

    private func decode(_ fixture: Fixture, _ change: (inout [String: Any]) -> Void) throws {
        let codec = try #require(FixtureCatalog.registry[fixture.contractName])
        let original = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture.url), options: [.fragmentsAllowed])
        let data = try JSONSerialization.data(withJSONObject: mutated(original, change), options: [.fragmentsAllowed])
        _ = try codec(data)
    }

    @Test(arguments: decodableFixtures)
    func everyFixtureDecodesWithAnUnknownKeyAtEveryObjectLevel(fixture: Fixture) throws {
        try decode(fixture) { $0["addedByANewerDaemon"] = ["nested": 1, "list": [1, 2]] as [String: Any] }
    }

    @Test(arguments: decodableFixtures)
    func everyFixtureDecodesWithUnknownEnumValues(fixture: Fixture) throws {
        try decode(fixture) { object in
            for key in Self.enumKeys where object[key] is String && !(key == "type" && fixture.contractName == "StreamEvent") { object[key] = Self.futureValue }
        }
    }

    private func machineJSON(_ extra: String = "", contract: Int = 4) -> Data {
        Data(#"""
        {"contractVersion":\#(contract),"name":"Studio","hostname":"studio.example.com","os":"macos","version":"4.2.0",
         "claudeVersion":null,"sessionsCount":0,"models":[],"ghosttyAutomation":"ok","allowBypass":true,
         "coordinatorEnabled":false,"homes":["main"],"tailscale":{"state":"running"}\#(extra)}
        """#.utf8)
    }

    @Test func aMachineWithoutFeaturesAndUpdateDecodesWithEmptyDefaults() throws {
        let machine = try JSONDecoder().decode(Machine.self, from: machineJSON())
        #expect(machine.features.isEmpty)
        #expect(machine.update == nil)
        #expect(!machine.supports(.chatImage))
    }

    @Test func featuresAndUpdateAreRead() throws {
        let extra = #","features":["chat-image","something-new"],"update":{"state":"failed","message":"disk full","version":"4.3.0"}"#
        let machine = try JSONDecoder().decode(Machine.self, from: machineJSON(extra))
        #expect(machine.supports(.chatImage))
        #expect(!machine.supports(.selfUpdate))
        #expect(machine.features.contains("something-new"))
        #expect(machine.update?.state == .failed)
        #expect(machine.update?.message == "disk full")
    }

    @Test func anUnknownUpdateStateDecodesAsUnknown() throws {
        let machine = try JSONDecoder().decode(Machine.self, from: machineJSON(#","update":{"state":"paused"}"#))
        #expect(machine.update?.state == .unknown)
    }

    @Test func anotherContractVersionDecodesAndIsMarkedIncompatible() throws {
        let machine = try JSONDecoder().decode(Machine.self, from: machineJSON(contract: 5))
        #expect(machine.contractVersion.value == 5)
        #expect(!machine.isCompatible)
        let current = try JSONDecoder().decode(Machine.self, from: machineJSON())
        #expect(current.isCompatible)
    }

    @Test func unknownEnumValuesBecomeTheUnknownCase() throws {
        let json = Data(#"{"os":"plan9","ghosttyAutomation":"later","tailscale":{"state":"weird"}}"#.utf8)
        struct Probe: Decodable {
            let os: MachineOS
            let ghosttyAutomation: GhosttyAutomation
            let tailscale: TailscaleStatus
        }
        let probe = try JSONDecoder().decode(Probe.self, from: json)
        #expect(probe.os == .unknown)
        #expect(probe.ghosttyAutomation == .unknown)
        #expect(probe.tailscale.state == .unknown)
    }

    @Test func anUnknownStreamEventTypeIsIgnoredNotFailed() throws {
        let event = try JSONDecoder().decode(StreamEvent.self, from: Data(#"{"type":"telepathy","payload":{"a":1}}"#.utf8))
        #expect(event == .unknown)
    }

    @Test func anUnknownActivityKindBecomesANeutralSystemLine() throws {
        let json = Data(#"{"kind":"hologram","id":"a1","ts":"2026-11-22T10:00:00.000Z","text":"x"}"#.utf8)
        let decoder = FardeskJSON.makeDecoder()
        guard case .system(let line) = try decoder.decode(Activity.self, from: json) else {
            Issue.record("expected a system line")
            return
        }
        #expect(line.id == "a1")
        #expect(line.text == unknownStateText)
    }

    @Test func theHubUpdateAnswerDecodesWithAnUnknownResult() throws {
        let json = Data(#"{"source":"Studio","version":"4.3.0","machines":[{"name":"Laptop","from":"4.2.0","result":"started"},{"name":"Box","from":"4.1.0","result":"paused","extra":1}]}"#.utf8)
        let result = try JSONDecoder().decode(HubUpdateResult.self, from: json)
        #expect(result.machines.map(\.result) == [.started, .unknown])
    }
}
