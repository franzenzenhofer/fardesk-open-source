import FardeskStore
import Testing

@Suite struct MarkdownBlocksTests {
    @Test func proseWithoutTablesStaysOneBlock() {
        #expect(MarkdownBlocks.split("Hello\n**bold** line") == [.prose("Hello\n**bold** line")])
    }

    @Test func pipeTableBetweenProseBecomesATable() {
        let text = "Before\n| Drill | Result |\n|---|:---:|\n| a | ok |\n| b | fail |\nAfter"
        #expect(MarkdownBlocks.split(text) == [
            .prose("Before"),
            .table(header: ["Drill", "Result"], rows: [["a", "ok"], ["b", "fail"]]),
            .prose("After"),
        ])
    }

    @Test func pipeLinesWithoutSeparatorStayProse() {
        let text = "| not | a table |\n| just | pipes |"
        #expect(MarkdownBlocks.split(text) == [.prose(text)])
    }

    @Test func tableAtTheStartAndEndHasNoEmptyProse() {
        let text = "| h |\n| - |\n| v |"
        #expect(MarkdownBlocks.split(text) == [.table(header: ["h"], rows: [["v"]])])
    }
}
