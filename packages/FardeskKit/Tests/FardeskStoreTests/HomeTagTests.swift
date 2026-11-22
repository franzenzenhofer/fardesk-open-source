import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct HomeTagTests {
    private func session(_ name: String, home: String?) throws -> SessionSummary {
        try Fixtures.session(name, overriding: ["home": home ?? NSNull()])
    }

    private func machine(homes: [String], sessions: [SessionSummary]) throws -> MachineState {
        var state = MachineState(endpoint: Fixtures.endpoint("Studio"))
        let facts = try Fixtures.machine(overriding: ["homes": homes])
        state.apply(.hello(machine: facts, sessions: sessions))
        return state
    }

    @Test func theTagShowsOnlyWhenTheMachineHasSeveralHomes() throws {
        let team = try session("working", home: "team")
        #expect(HomeTag.text(for: team, machineHomes: ["team", "private"]) == "team")
        #expect(HomeTag.text(for: team, machineHomes: ["team"]) == nil)
        #expect(HomeTag.text(for: try session("working", home: nil), machineHomes: ["team", "private"]) == nil)
    }

    @Test func theFilterKeepsOnlyTheSessionsOfOneHome() throws {
        let sessions = [try session("working", home: "team"), try session("idleResume", home: "private"), try session("endedTakeover", home: nil)]
        #expect(HomeTag.filtered(sessions, by: nil).count == 3)
        #expect(HomeTag.filtered(sessions, by: "private").map(\.home) == ["private"])
        #expect(HomeTag.filtered(sessions, by: "missing").isEmpty)
    }

    @Test func theFilterOffersTheHomesOfMachinesWithSeveralOnly() throws {
        let two = try machine(homes: ["team", "private"], sessions: [])
        let one = try machine(homes: ["solo"], sessions: [])
        #expect(HomeTag.filterChoices(machines: [two, one]) == ["private", "team"])
        #expect(HomeTag.filterChoices(machines: [one]).isEmpty)
    }

    @Test func theInfoSheetNamesTheHome() throws {
        let facts = SessionFacts(session: try session("working", home: "team"), machineName: "Studio")
        #expect(facts.rows.first { $0.label == "Claude home" }?.value == "team")
        let none = SessionFacts(session: try session("working", home: nil), machineName: "Studio")
        #expect(none.rows.contains { $0.label == "Claude home" } == false)
    }

    @Test func theHeaderLineCarriesTheTagNextToTheMachineName() throws {
        let line = SessionHeaderLine(session: try session("working", home: "team"), machineName: "Studio", homeTag: "team")
        #expect(line.leadText.hasPrefix("Studio \u{00B7} team \u{00B7} "))
    }

    @Test func theNewSessionRequestCarriesTheChosenHome() {
        var draft = NewSessionDraft()
        draft.folder = "/Users/dev/app"
        draft.prompt = "go"
        #expect(draft.request(homeChoices: []).home == nil)
        #expect(draft.request(homeChoices: ["team", "private"]).home == "team")
        draft.homeName = "private"
        #expect(draft.request(homeChoices: ["team", "private"]).home == "private")
        draft.homeName = "gone"
        #expect(draft.request(homeChoices: ["team", "private"]).home == "team")
        draft.resetForMachine(firstFolder: "/Users/dev/other")
        #expect(draft.homeName == nil)
    }

    @Test func aMachineOffersItsHomesToTheSheetOnlyWhenThereAreSeveral() {
        let several = OnlineMachine(id: UUID(), name: "Studio", models: [], homes: ["team", "private"])
        let single = OnlineMachine(id: UUID(), name: "Box", models: [], homes: ["solo"])
        #expect(HomeTag.newSessionChoices(for: several) == ["team", "private"])
        #expect(HomeTag.newSessionChoices(for: single).isEmpty)
        #expect(HomeTag.newSessionChoices(for: nil).isEmpty)
    }
}
