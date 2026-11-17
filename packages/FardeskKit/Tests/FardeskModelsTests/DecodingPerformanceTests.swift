import Foundation
import FardeskModels
import Testing

/// Guards the cost of wire decoding. Measured 2026-11-16 (release-like debug test build, M-series Mac):
/// a 200-item ActivityPage decodes in ~0.4 ms and a 100-session hello in ~0.6 ms, of which the ISO-8601
/// timestamps are ~0.1 ms, so no custom timestamp parser or shared decoder is needed. These budgets are
/// 50x that and only trip on a real regression.
struct DecodingPerformanceTests {
    private static let rounds = 50
    private static let budgetMilliseconds = 25.0

    private func fixtureObject(_ relative: String) throws -> [String: Any] {
        let url = FixtureCatalog.fixturesDirectory.appending(path: relative)
        return try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func activityPage(items: Int) throws -> Data {
        let item = try fixtureObject("Activity/user.json")
        let page: [String: Any] = ["nextBefore": NSNull(), "items": (0..<items).map { index -> [String: Any] in
            var copy = item
            copy["id"] = "act_\(index)"
            return copy
        }]
        return try JSONSerialization.data(withJSONObject: page)
    }

    private func hello(sessions count: Int) throws -> Data {
        var event = try fixtureObject("StreamEvent/helloWithSessions.json")
        let sessions = try #require(event["sessions"] as? [[String: Any]])
        event["sessions"] = (0..<count).map { index -> [String: Any] in
            var copy = sessions[index % sessions.count]
            copy["id"] = "sess_\(index)"
            return copy
        }
        return try JSONSerialization.data(withJSONObject: event)
    }

    private func milliseconds(_ work: () throws -> Void) rethrows -> Double {
        let elapsed = try ContinuousClock().measure { for _ in 0..<Self.rounds { try work() } }
        let parts = elapsed.components
        return (Double(parts.seconds) * 1_000 + Double(parts.attoseconds) / 1e15) / Double(Self.rounds)
    }

    @Test func aTwoHundredItemPageDecodesWithinBudget() throws {
        let page = try activityPage(items: 200)
        let cost = try milliseconds { _ = try FardeskJSON.makeDecoder().decode(ActivityPage.self, from: page) }
        #expect(cost < Self.budgetMilliseconds, "ActivityPage(200) took \(cost) ms")
    }

    @Test func aHundredSessionHelloDecodesWithinBudget() throws {
        let event = try hello(sessions: 100)
        let cost = try milliseconds { _ = try FardeskJSON.makeDecoder().decode(StreamEvent.self, from: event) }
        #expect(cost < Self.budgetMilliseconds, "hello(100 sessions) took \(cost) ms")
    }
}
