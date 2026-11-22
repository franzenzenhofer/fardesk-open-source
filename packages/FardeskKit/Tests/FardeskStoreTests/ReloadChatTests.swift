import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Actions > More > Reload chat (owner, 2026-11-22): everything this device holds for a stuck chat goes, so the
/// screen can only show what the machine has. The machine here never answers, so only the local part runs.
@MainActor
struct ReloadChatTests {
    @Test func reloadDropsCachedRowsSentBubblesAndTheCacheFileButKeepsUnsentMessages() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, endpoint) = try await sandbox.startedModelWithSessions()
            let ref = SessionRef(machineID: endpoint.id, sessionID: "sess_2c84be")
            let rows = [try Fixtures.activity("assistant")]
            model.feeds.restore(FeedSnapshot(activities: rows, nextBefore: nil), for: ref)
            try sandbox.cache.saveFeed(FeedSnapshot(activities: rows, nextBefore: nil), machineID: ref.machineID, sessionID: ref.sessionID)
            let stuck = model.outbox.add(OutgoingMessage(text: "See attached."), to: ref, kind: .reply, at: Date())
            model.outbox.set(stuck, .sent)
            let unsent = model.outbox.add(OutgoingMessage(text: "still here"), to: ref, kind: .reply, at: Date())
            model.outbox.set(unsent, .failed("no route"))

            await model.reloadChat(ref)

            #expect(model.feeds.feed(for: ref).activities.isEmpty, "the old rows are gone")
            #expect(model.outbox.message(stuck) == nil, "the stuck bubble is gone")
            #expect(model.outbox.message(unsent) != nil, "a message that never left the phone stays")
            #expect(sandbox.cache.loadFeed(machineID: ref.machineID, sessionID: ref.sessionID) == nil, "the cached chat file is gone")
            model.stop()
        }
    }
}
