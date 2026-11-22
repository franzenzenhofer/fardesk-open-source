import FardeskFixtures
import FardeskModels
import Foundation
import Testing

@testable import FardeskStore

private let base = Date(timeIntervalSince1970: 1_800_000_000)

@Suite("The session list holds its order")
struct SessionListStabilityTests {
    private func session(
        _ id: String, _ status: String, at seconds: Double, waitingFor: String? = nil, pinned: Bool = false
    ) throws -> SessionSummary {
        let stamp = Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(base.addingTimeInterval(seconds))
        var overrides: [String: any Sendable] = ["id": id, "status": status, "updatedAt": stamp]
        if pinned { overrides["label"] = ["name": "Mine", "color": "#8E0443", "pinned": true] as [String: any Sendable] }
        overrides["waitingFor"] = waitingFor ?? NSNull()
        return try Fixtures.session("working", overriding: overrides)
    }

    private func ids(_ machine: MachineState) -> [String] { machine.listedSessions.map(\.id) }

    private func machine(with sessions: [SessionSummary]) throws -> MachineState {
        var machine = MachineState(endpoint: Fixtures.endpoint("Studio"))
        machine.apply(.hello(machine: try Fixtures.machine(), sessions: sessions))
        return machine
    }

    private func at(_ seconds: Double) -> Date { base.addingTimeInterval(seconds) }

    /// Two idle sessions where "a" finished a turn after the list was built: "a" is held below "b".
    private func holdingState() throws -> (state: AppState, machineID: UUID) {
        let machine = try machine(with: [try session("a", "idle", at: 0), try session("b", "idle", at: 10)])
        var state = AppState(machines: [machine])
        try state.apply(.session(try session("a", "working", at: 50)), from: machine.id)
        try state.apply(.session(try session("a", "idle", at: 60)), from: machine.id)
        #expect(ids(try state.machine(id: machine.id)) == ["b", "a"])
        return (state, machine.id)
    }

    @Test("A working session that writes many lines does not move above an idle one")
    func linesDoNotMoveRows() throws {
        var machine = try machine(with: [try session("busy", "working", at: 0), try session("calm", "idle", at: 10)])
        #expect(ids(machine) == ["calm", "busy"])
        for line in 1...20 {
            machine.apply(.session(try session("busy", "working", at: 20 + Double(line))))
        }
        #expect(ids(machine) == ["calm", "busy"])
    }

    @Test("A finished turn is held: the row does not move during active use")
    func finishedTurnIsHeld() throws {
        var machine = try machine(with: [try session("busy", "working", at: 0), try session("calm", "idle", at: 10)])
        machine.apply(.session(try session("busy", "idle", at: 100)))
        #expect(ids(machine) == ["calm", "busy"])
        machine.releaseHeldOrder()
        #expect(ids(machine) == ["busy", "calm"])
    }

    @Test("Navigating list to chat and back many times never applies held moves")
    func backAndForthDoesNotReorder() throws {
        var (state, id) = try holdingState()
        for round in 1...5 {
            state.noteActivity(.active, at: at(100 + Double(round)))
            try state.apply(.session(try session("a", "idle", at: 60)), from: id)
            #expect(ids(try state.machine(id: id)) == ["b", "a"])
        }
    }

    @Test("Away for less than two minutes then active: no reorder")
    func shortAbsenceKeepsOrder() throws {
        var (state, id) = try holdingState()
        state.noteActivity(.away, at: at(100))
        state.noteActivity(.active, at: at(100 + ReturnAfterPause.refreshAfterAbsence - 1))
        #expect(ids(try state.machine(id: id)) == ["b", "a"])
    }

    @Test("Away for two minutes or more then active: the held moves apply")
    func longAbsenceReorders() throws {
        var (state, id) = try holdingState()
        state.noteActivity(.away, at: at(100))
        state.noteActivity(.active, at: at(100 + ReturnAfterPause.refreshAfterAbsence))
        #expect(ids(try state.machine(id: id)) == ["a", "b"])
    }

    @Test("Several away notes count from the first one")
    func awayCountsFromFirstNote() throws {
        var (state, id) = try holdingState()
        state.noteActivity(.away, at: at(100))
        state.noteActivity(.away, at: at(210))
        state.noteActivity(.active, at: at(230))
        #expect(ids(try state.machine(id: id)) == ["a", "b"])
    }

    @Test("A move that arrives with the fresh state after a long absence is applied too")
    func moveInNextHelloAppliesAfterLongAbsence() throws {
        var (state, id) = try holdingState()
        state.noteActivity(.away, at: at(100))
        state.noteActivity(.active, at: at(300))
        try state.apply(.session(try session("b", "working", at: 310)), from: id)
        try state.apply(.session(try session("b", "idle", at: 320)), from: id)
        let hello = StreamEvent.hello(machine: try Fixtures.machine(), sessions: [try session("a", "idle", at: 60), try session("b", "idle", at: 320)])
        try state.apply(hello, from: id)
        #expect(ids(try state.machine(id: id)) == ["b", "a"])
        try state.apply(.session(try session("a", "working", at: 400)), from: id)
        try state.apply(.session(try session("a", "idle", at: 410)), from: id)
        #expect(ids(try state.machine(id: id)) == ["b", "a"], "after that one hello the order is held again")
    }

    @Test("Pull to refresh applies the held reorder")
    func refreshReleases() throws {
        var machine = try machine(with: [try session("a", "idle", at: 0), try session("b", "idle", at: 10)])
        machine.apply(.session(try session("a", "working", at: 50)))
        #expect(ids(machine) == ["b", "a"])
        machine.releaseHeldOrder()
        #expect(ids(machine) == ["a", "b"])
    }

    @Test("A newly waiting session moves into needs-you at once")
    func newlyWaitingMoves() throws {
        var machine = try machine(with: [try session("a", "idle", at: 0), try session("b", "idle", at: 10), try session("c", "idle", at: 20)])
        machine.apply(.session(try session("a", "waiting", at: 60, waitingFor: "question")))
        #expect(ids(machine) == ["a", "c", "b"])
    }

    @Test("New sessions appear at the top at once and gone ones disappear")
    func appearAndDisappear() throws {
        var machine = try machine(with: [try session("a", "idle", at: 0), try session("b", "idle", at: 10)])
        machine.apply(.session(try session("new", "idle", at: 100)))
        #expect(ids(machine) == ["new", "b", "a"])
        machine.apply(.hello(machine: try Fixtures.machine(), sessions: [try session("new", "idle", at: 100), try session("a", "idle", at: 0)]))
        #expect(ids(machine) == ["new", "a"])
    }

    @Test("Pinned sessions stay first")
    func pinnedStaysFirst() throws {
        var machine = try machine(with: [try session("old", "idle", at: 0, pinned: true), try session("new", "idle", at: 10)])
        machine.apply(.session(try session("new", "working", at: 50)))
        machine.apply(.session(try session("new", "idle", at: 60)))
        machine.releaseHeldOrder()
        #expect(ids(machine) == ["old", "new"])
    }

    @Test("Pinning a session moves it first at once")
    func pinningAppliesAtOnce() throws {
        var machine = try machine(with: [try session("a", "idle", at: 0), try session("b", "idle", at: 10)])
        machine.apply(.session(try session("a", "idle", at: 0, pinned: true)))
        #expect(ids(machine) == ["a", "b"])
    }
}
