import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct SessionFactsTests {
    @Test func theInfoSheetListsEveryKnownFactWithItsLabel() throws {
        let session = try Fixtures.session("working")
        let facts = SessionFacts(session: session, machineName: "Linux")
        let labels = facts.rows.map(\.label)
        #expect(labels.prefix(4) == ["Status", "Agent", "Machine", "Started in"])
        #expect(labels.contains("Session ID") && labels.contains("Started") && labels.contains("Last activity"))
        #expect(facts.rows.first { $0.label == "Machine" }?.value == "Linux")
        #expect(facts.rows.first { $0.label == "Started in" }?.value == session.cwd)
        #expect(facts.rows.first { $0.label == "Session ID" }?.value == session.id)
        #expect(facts.rows.first { $0.label == "Runs in" }?.value == (session.owned ? "Fardesk (no terminal)" : "a terminal"))
    }
}
