import CryptoKit
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct SemanticVersionTests {
    @Test func comparesNumberByNumber() throws {
        let older = try #require(SemanticVersion("4.9.0"))
        let newer = try #require(SemanticVersion("4.10.0"))
        #expect(older < newer)
        #expect(try #require(SemanticVersion("4.2")) == #require(SemanticVersion("4.2.0")))
        #expect(try #require(SemanticVersion("5.0.0")) > #require(SemanticVersion("4.99.99")))
        #expect(try #require(SemanticVersion("4.2.1-beta")) == #require(SemanticVersion("4.2.1")))
    }

    @Test func refusesTextThatIsNotAVersion() {
        #expect(SemanticVersion("") == nil)
        #expect(SemanticVersion("unknown") == nil)
        #expect(SemanticVersion("4.x.0") == nil)
        #expect(SemanticVersion("4..0") == nil)
    }
}

/// **Update all** against real local HTTP servers that play the lifeline routes of several machines.
@MainActor
struct UpdateAllTests {
    private func hello(_ version: String, contract: Int = 4) throws -> StreamEvent {
        let json = #"""
        {"type":"hello","sessions":[],"machine":{"contractVersion":\#(contract),"name":"Box","hostname":"box.example.com","os":"linux",
         "version":"\#(version)","claudeVersion":null,"sessionsCount":0,"models":[],"ghosttyAutomation":"unknown",
         "allowBypass":true,"coordinatorEnabled":false,"homes":["main"],"tailscale":{"state":"running"}}}
        """#
        return try FardeskJSON.makeDecoder().decode(StreamEvent.self, from: Data(json.utf8))
    }

    private struct Rig {
        let model: AppModel
        let ids: [String: UUID]
    }

    /// A model with one machine per server (name -> server, reported version), already stopped so only the test acts.
    private func rig(
        _ sandbox: StoreSandbox, _ machines: [(String, UpdateServer, String)], configuration: AppModelConfiguration? = nil
    ) async throws -> Rig {
        var list = MachineList()
        var ids: [String: UUID] = [:]
        for (name, server, _) in machines {
            let endpoint = MachineEndpoint(name: name, url: try #require(URL(string: "http://127.0.0.1:\(server.port)")))
            list.add(endpoint)
            try sandbox.keychainTokens.save("t0k", endpoint.id)
            ids[name] = endpoint.id
        }
        try sandbox.machinesFile.save(list)
        let model = AppModel(configuration: configuration ?? sandbox.configuration())
        await model.start()
        model.stop()
        for (name, _, version) in machines { model.apply(try hello(version), from: try #require(ids[name])) }
        return Rig(model: model, ids: ids)
    }

    private func started(_ servers: [UpdateServer]) async throws {
        for server in servers { try await server.start() }
    }

    @Test func thePlanNamesTheSourceAndTheOlderMachines() async throws {
        try await StoreSandbox.with { sandbox in
            let (newest, older, same) = (try UpdateServer(version: "4.3.0"), try UpdateServer(version: "4.2.0"), try UpdateServer(version: "4.3.0"))
            try await started([newest, older, same])
            defer { [newest, older, same].forEach { $0.stop() } }
            let rig = try await rig(sandbox, [("Newest", newest, "4.3.0"), ("Older", older, "4.2.0"), ("Same", same, "4.3.0")])
            let plan = rig.model.updatePlan
            #expect(plan.source?.versionText == "4.3.0")
            #expect(plan.targets.map(\.name) == ["Older"])
            #expect(plan.needsUpdate(try #require(rig.ids["Older"])))
            #expect(!plan.needsUpdate(try #require(rig.ids["Same"])))
            #expect(plan.summary == "1 machine can be updated")
        }
    }

    @Test func nothingToUpdateWhenAllMachinesRunTheSameRelease() async throws {
        try await StoreSandbox.with { sandbox in
            let (first, second) = (try UpdateServer(version: "4.3.0"), try UpdateServer(version: "4.3.0"))
            try await started([first, second])
            defer { [first, second].forEach { $0.stop() } }
            let rig = try await rig(sandbox, [("One", first, "4.3.0"), ("Two", second, "4.3.0")])
            #expect(rig.model.updatePlan.isEmpty)
            #expect(rig.model.updatePlan.summary == nil)
            await rig.model.updateAll()
            #expect(rig.model.machineUpdates.isEmpty)
            #expect(first.posted.isEmpty && second.posted.isEmpty)
        }
    }

    @Test func aMachineOfAnotherMajorIsMarkedAndStillUpdatable() async throws {
        try await StoreSandbox.with { sandbox in
            let (newest, odd) = (try UpdateServer(version: "4.3.0"), try UpdateServer(version: "5.0.0"))
            try await started([newest, odd])
            defer { [newest, odd].forEach { $0.stop() } }
            let rig = try await rig(sandbox, [("Newest", newest, "4.3.0"), ("Odd", odd, "4.3.0")])
            rig.model.apply(try hello("4.0.0", contract: 5), from: try #require(rig.ids["Odd"]))
            #expect(rig.model.runsDifferentVersion(try #require(rig.ids["Odd"])))
            #expect(!rig.model.runsDifferentVersion(try #require(rig.ids["Newest"])))
            #expect(rig.model.updatePlan.needsUpdate(try #require(rig.ids["Odd"])))
        }
    }

    @Test func theAppRelaysThePackageFromTheNewestMachineAndFollowsEachOne() async throws {
        let package = Data((0..<4_000).map { UInt8($0 % 251) })
        let expected = SHA256.hash(data: package).map { String(format: "%02x", $0) }.joined()
        try await StoreSandbox.with { sandbox in
            let newest = try UpdateServer(version: "4.3.0", package: package)
            let good = try UpdateServer(version: "4.2.0", outcome: .becomesNewer("4.3.0"))
            let bad = try UpdateServer(version: "4.1.0", outcome: .fails("not enough disk space"))
            let refusing = try UpdateServer(version: "4.1.0", outcome: .refuses)
            try await started([newest, good, bad, refusing])
            defer { [newest, good, bad, refusing].forEach { $0.stop() } }
            let rig = try await rig(sandbox, [("Newest", newest, "4.3.0"), ("Good", good, "4.2.0"), ("Bad", bad, "4.1.0"), ("Refusing", refusing, "4.1.0")])
            await rig.model.updateAll()

            #expect(newest.requestedPaths.contains("GET /v1/update/package"))
            #expect(newest.posted.isEmpty)
            let sent = try #require(good.posted.first)
            #expect(sent.body == package)
            #expect(sent.sha256 == expected)
            #expect(sent.contentType == "application/gzip")
            let updates = rig.model.machineUpdates
            #expect(updates[try #require(rig.ids["Good"])] == .updated(version: "4.3.0"))
            #expect(updates[try #require(rig.ids["Bad"])] == .failed(message: "not enough disk space"))
            guard case .failed(let message)? = updates[try #require(rig.ids["Refusing"])] else {
                Issue.record("the refused install must show as failed")
                return
            }
            #expect(message.contains("update refused"))
            #expect(updates[try #require(rig.ids["Newest"])] == nil)
        }
    }

    @Test func aMachineThatNeverChangesIsGivenUpWithAPlainMessage() async throws {
        try await StoreSandbox.with { sandbox in
            let newest = try UpdateServer(version: "4.3.0", package: Data([1, 2, 3]))
            let stuck = try UpdateServer(version: "4.2.0", outcome: .becomesNewer("4.2.0"))
            try await started([newest, stuck])
            defer { [newest, stuck].forEach { $0.stop() } }
            let rig = try await rig(
                sandbox, [("Newest", newest, "4.3.0"), ("Stuck", stuck, "4.2.0")],
                configuration: sandbox.configuration(updatePollInterval: 0.05, updateGiveUpAfter: 0.3)
            )
            await rig.model.updateAll()
            guard case .failed(let message)? = rig.model.machineUpdates[try #require(rig.ids["Stuck"])] else {
                Issue.record("a machine that stays on its version must show as failed")
                return
            }
            #expect(message.hasPrefix("Not updated after"))
        }
    }
}
