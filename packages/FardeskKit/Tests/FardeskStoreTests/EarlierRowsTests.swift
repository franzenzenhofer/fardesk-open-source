@testable import FardeskStore
import Testing

/// "Load earlier messages" shows what it brought: exactly the rows above the old first row, counted.
struct EarlierRowsTests {
    @Test func theRowsAboveTheOldFirstRowAreTheNewOnes() throws {
        let rows = try #require(EarlierRows(blockIDs: ["a", "b", "c", "d"], previousFirstID: "c"))
        #expect(rows.ids == ["a", "b"])
        #expect(rows.boundaryID == "c")
        #expect(rows.label == "2 earlier messages loaded")
        #expect(EarlierRows(blockIDs: ["x", "c"], previousFirstID: "c")?.label == "1 earlier message loaded")
    }

    @Test func nothingNewOrNoOldRowGivesNothing() {
        #expect(EarlierRows(blockIDs: ["c", "d"], previousFirstID: "c") == nil, "the page brought nothing above")
        #expect(EarlierRows(blockIDs: ["a"], previousFirstID: nil) == nil)
        #expect(EarlierRows(blockIDs: ["a"], previousFirstID: "gone") == nil)
    }
}
