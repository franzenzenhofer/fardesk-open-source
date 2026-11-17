import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct FeedBlocksTests {
    @Test func consecutiveToolRowsFoldIntoOneStepsTeaser() throws {
        let blocks = FeedBlock.group(try Fixtures.activities())
        let groups = blocks.compactMap { block -> FeedSteps? in
            if case .steps(_, let steps) = block { steps } else { nil }
        }
        #expect(groups.count == 1)
        #expect(groups[0].count == 4)
        #expect(groups[0].text.hasPrefix("4 steps \u{00B7} "))
        #expect(blocks.count == blocks.map(\.id).count)
    }

    @Test func oneStepShowsOnlyItsLine() throws {
        guard case .files(let files) = try Fixtures.activity("files") else { throw FixtureShapeError() }
        #expect(FeedSteps(count: 1, latest: FeedToolRow(files: files)).text == "Edited PaintEngine.swift")
    }

    @Test func fileRowsSplitVerbAndFile() throws {
        guard case .files(let files) = try Fixtures.activity("files") else { throw FixtureShapeError() }
        let row = FeedToolRow(files: files)
        #expect(row.verb == "Edited")
        #expect(row.detail == "PaintEngine.swift")
        #expect(row.opensDetail)
    }

    @Test func testRunsKeepTheirOutcomeAfterAMiddleDot() throws {
        guard case .tool(let ok) = try Fixtures.activity("toolOk") else { throw FixtureShapeError() }
        let row = FeedToolRow(tool: ok)
        #expect(row.verb == "Ran swift test \u{00B7} 31 passed")
        #expect(row.detail == nil)
        #expect(row.isSuccess)
    }

    @Test func runningRowsEndInEllipsis() throws {
        guard case .tool(let running) = try Fixtures.activity("toolRunning") else { throw FixtureShapeError() }
        let row = FeedToolRow(tool: running)
        #expect(row.verb == "Running swift test...")
        #expect(row.isRunning)
    }

    @Test func headerLineCarriesTheTone() throws {
        let working = SessionHeaderLine(session: try Fixtures.session("working"), machineName: "Mac")
        #expect(working.tone == .working)
        #expect(working.statusLabel == "Working")
        #expect(working.leadText.hasPrefix("Mac \u{00B7} "))
        let waiting = SessionHeaderLine(session: try Fixtures.session("waitingPermission"), machineName: "Mac")
        #expect(waiting.tone == .attention)
        let idle = SessionHeaderLine(session: try Fixtures.session("idleResume"), machineName: "Mac")
        #expect(idle.tone == .quiet)
    }
}
