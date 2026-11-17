@testable import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct FollowStopTests {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    private func decide(
        _ status: SessionStatus, _ row: FollowRowKind, idleFor: TimeInterval?, elapsed: TimeInterval = 10, timeout: TimeInterval = 600
    ) -> FollowStop {
        let now = start.addingTimeInterval(elapsed)
        return FollowStop.decide(
            status: status, lastRowKind: row, nonWorkingSince: idleFor.map { now.addingTimeInterval(-$0) },
            now: now, startedAt: start, timeout: timeout
        )
    }

    @Test func aWorkingSessionKeepsGoing() {
        #expect(decide(.working, .assistantText, idleFor: nil) == .keepGoing)
    }

    @Test func anIdleGapAfterAToolRowKeepsGoingHoweverLongItLasts() {
        #expect(decide(.idle, .other, idleFor: 0.5) == .keepGoing)
        #expect(decide(.idle, .other, idleFor: 30) == .keepGoing)
    }

    @Test func waitingStopsAtOnce() {
        #expect(decide(.waiting, .other, idleFor: 0) == .needsYou)
    }

    @Test func idleWithAssistantTextStopsOnlyAfterTheSettleTime() {
        #expect(decide(.idle, .assistantText, idleFor: FollowStop.settleTime - 0.1) == .keepGoing)
        #expect(decide(.idle, .assistantText, idleFor: FollowStop.settleTime) == .turnEnded)
        #expect(decide(.ended, .assistantText, idleFor: 10) == .turnEnded)
    }

    @Test func theTimeoutStopsAWorkingSession() {
        #expect(decide(.working, .other, idleFor: nil, elapsed: 599, timeout: 600) == .keepGoing)
        #expect(decide(.working, .other, idleFor: nil, elapsed: 600, timeout: 600) == .timedOut)
        #expect(decide(.idle, .other, idleFor: 5, elapsed: 700, timeout: 600) == .timedOut)
    }

    @Test func rowKindsAreTold() throws {
        #expect(FollowRowKind(try Fixtures.activity("assistant")) == .assistantText)
        #expect(FollowRowKind(try Fixtures.activity("permissionPending")) == .other)
        #expect(FollowRowKind(nil) == .other)
    }

    @Test func theHintNamesTheCommandThatSettlesThePendingRequest() throws {
        let permission = try Fixtures.activity("permissionPending")
        let question = try Fixtures.activity("questionPending")
        guard case .permission(let p) = permission, case .question(let q) = question else {
            Issue.record("fixtures have the wrong kinds")
            return
        }
        let short = ShortID.short("abcdef12-0000")
        #expect(FollowStop.hint(for: [permission], sessionID: "abcdef12-0000") == "Needs you: fardesk approve \(short) \(p.requestId)")
        #expect(FollowStop.hint(for: [question], sessionID: "abcdef12-0000")?.hasPrefix("Needs you: fardesk answer \(short) <") == true)
        #expect(FollowStop.hint(for: [question], sessionID: "abcdef12-0000")?.hasSuffix(q.requestId) == true)
        #expect(FollowStop.hint(for: [try Fixtures.activity("assistant")], sessionID: "abcdef12-0000") == nil)
    }
}
