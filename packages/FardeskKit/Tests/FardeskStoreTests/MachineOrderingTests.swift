import FardeskFixtures
import FardeskModels
import Foundation
import Testing

@testable import FardeskStore

private let base = Date(timeIntervalSince1970: 1_800_000_000)

@Suite("Machine order and the ended-session cap")
struct MachineOrderingTests {
    private func state(_ name: String, os: MachineOS?) -> MachineState {
        var machine = MachineState(endpoint: Fixtures.endpoint(name))
        if let os { machine.apply(hub: HubMachine(name: name, online: true, os: os)) }
        return machine
    }

    @Test("Without a configured order the machines are alphabetical, whatever their OS")
    func alphabeticalByDefault() {
        let machines = [
            state("Linux", os: .linux), state("Zeta", os: nil), state("Laptop", os: .macos),
            state("Studio", os: .macos), state("Alpha", os: .linux),
        ]
        let names = MachineOrdering.sorted(machines).map(\.endpoint.name)
        #expect(names == ["Alpha", "Laptop", "Linux", "Studio", "Zeta"])
    }

    @Test("The configured names come first in the configured order (any case), the rest by name")
    func configuredOrder() {
        let machines = [state("Alpha", os: nil), state("Linux", os: .linux), state("Studio", os: .macos), state("Laptop", os: .macos)]
        let names = MachineOrdering.sorted(machines, preferred: ["studio", "Laptop", "Studio"]).map(\.endpoint.name)
        #expect(names == ["Studio", "Laptop", "Alpha", "Linux"])
    }

    @Test("The build setting is a list of names separated by semicolons")
    func parsesTheBuildSetting() {
        #expect(MachineOrdering.parse(" Studio ; ;Laptop;Build server") == ["Studio", "Laptop", "Build server"])
        #expect(MachineOrdering.parse("").isEmpty)
    }

    @Test("Two machines with the same name keep a stable order by id")
    func sameNameTiesById() {
        let one = state("Studio", os: nil)
        let two = state("Studio", os: nil)
        let ids = MachineOrdering.sorted([one, two]).map(\.id.uuidString)
        #expect(ids == ids.sorted())
    }

    @Test("The hub's os is encoded when present and old hubs without it still decode")
    func hubOsCoding() throws {
        let withOs = HubMachine(name: "A", online: true, os: .linux)
        let data = try JSONEncoder().encode(withOs)
        #expect(try JSONDecoder().decode(HubMachine.self, from: data).os == .linux)
        var object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["os"] = nil
        let old = try JSONSerialization.data(withJSONObject: object)
        #expect(try JSONDecoder().decode(HubMachine.self, from: old).os == nil)
    }

    @Test("AppState keeps machines in order after sync")
    func syncOrders() {
        let endpoints = ["Linux", "Studio", "Alpha"].map { Fixtures.endpoint($0) }
        var app = AppState(machineOrder: ["Studio"])
        app.sync(endpoints: endpoints)
        #expect(app.machines.map(\.endpoint.name) == ["Studio", "Alpha", "Linux"])
        #expect(AppState(endpoints: endpoints, machineOrder: ["Linux"]).machines.map(\.endpoint.name) == ["Linux", "Alpha", "Studio"])
    }

    @Test("Live sessions all show; only the newest ended ones up to the cap")
    func endedCap() throws {
        var machine = MachineState(endpoint: Fixtures.endpoint("Studio"))
        let live = try (0..<14).map { try session("live\($0)", "working", ago: Double($0)) }
        let ended = try (0..<15).map { try session("done\($0)", "ended", ago: Double(100 + $0)) }
        machine.apply(.hello(machine: try Fixtures.machine(), sessions: ended + live))
        #expect(machine.activeSessions.count == 14)
        #expect(machine.endedSessions.map(\.id) == (0..<MachineState.endedRowLimit).map { "done\($0)" })
        #expect(machine.listedSessions.count == 14 + MachineState.endedRowLimit)
    }

    private func session(_ id: String, _ status: String, ago seconds: Double) throws -> SessionSummary {
        try Fixtures.session("working", overriding: ["id": id, "status": status, "updatedAt": Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(base.addingTimeInterval(-seconds))])
    }
}
