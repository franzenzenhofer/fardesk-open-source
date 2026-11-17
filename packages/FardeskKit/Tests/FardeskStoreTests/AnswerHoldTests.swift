import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// A message to a session that waits on a permission or question is held, then sent once the user has answered:
/// typed into the open dialog it would answer it and lose its "Attached image:" lines.
@MainActor
struct AnswerHoldTests {
    @Test func aReplyToAWaitingSessionIsHeldWithItsReasonAndNotSent() async throws {
        let sandbox = try StoreSandbox()
        let (model, endpoint) = try await sandbox.startedModelWithSessions()
        let waiting = try #require(model.state.machines.first?.sessions.first { $0.status == .waiting }, "the fixture has a waiting session")
        let ref = SessionRef(machineID: endpoint.id, sessionID: waiting.id)
        let id = model.outbox.add(OutgoingMessage(text: "look at this"), to: ref, kind: .reply, at: Date())
        await model.deliver(id)
        #expect(model.outbox.message(id)?.state == .queued(waitingFor: AppModel.waitingForAnswer))
        #expect(model.outbox.message(id)?.statusLabel == "Queued - waiting for your answer")
        model.stop()
    }
}
