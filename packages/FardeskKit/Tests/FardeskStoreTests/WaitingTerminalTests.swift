import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// #87: a bare "waiting" with nothing to approve is its own state, shown as "needs you" with where to answer, and a
/// message typed meanwhile is never held for an answer the phone cannot give.
@MainActor
struct WaitingTerminalTests {
    @Test func aTerminalWaitIsOrangeAndSaysWhereToAnswer() throws {
        let session = try Fixtures.session("waitingTerminal")
        #expect(session.waitingFor == .terminal)
        let presentation = SessionPresentation(session: session, now: Date())
        #expect(presentation.statusLabel == "Needs you at the computer")
        #expect(presentation.subtitleParts == ["Needs you at the computer: permission prompt"])
        #expect(StateTone(status: session.status) == .needsYou)
        #expect(session.replyMode == .composer)
    }

    @Test func onlyAPermissionOrQuestionHoldsAMessage() throws {
        #expect(WaitingReason.permission.phoneCanAnswer)
        #expect(WaitingReason.question.phoneCanAnswer)
        #expect(!WaitingReason.terminal.phoneCanAnswer)
    }

    @Test func aTerminalWaitIsNotAnAnswerableRequestButAPermissionIs() async throws {
        let sandbox = try StoreSandbox()
        let (model, endpoint) = try await sandbox.startedModelWithSessions()
        let permission = try #require(model.state.machines.first?.sessions.first { $0.waitingFor == .permission })
        let permissionRef = SessionRef(machineID: endpoint.id, sessionID: permission.id)
        #expect(model.awaitsPhoneAnswer(permissionRef))
        model.apply(try Fixtures.event("session_waitingTerminal"), from: endpoint.id)
        let terminal = try Fixtures.session("waitingTerminal")
        #expect(!model.awaitsPhoneAnswer(SessionRef(machineID: endpoint.id, sessionID: terminal.id)))
        model.stop()
    }

    @Test func aHeldReplyIsReleasedWhenTheRequestBecomesATerminalWait() async throws {
        let sandbox = try StoreSandbox()
        let (model, endpoint) = try await sandbox.startedModelWithSessions()
        let waiting = try #require(model.state.machines.first?.sessions.first { $0.waitingFor == .permission })
        let ref = SessionRef(machineID: endpoint.id, sessionID: waiting.id)
        let id = model.outbox.add(OutgoingMessage(text: "after the answer"), to: ref, kind: .reply, at: Date())
        await model.deliver(id)
        #expect(model.outbox.message(id)?.state == .queued(waitingFor: AppModel.waitingForAnswer))
        let expired = try Fixtures.session("waitingTerminal", overriding: ["id": waiting.id, "title": waiting.title])
        model.apply(.session(expired), from: endpoint.id)
        model.releaseAnswerHolds()
        for _ in 0..<100 where model.outbox.message(id)?.state == .queued(waitingFor: AppModel.waitingForAnswer) {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(model.outbox.message(id)?.state != .queued(waitingFor: AppModel.waitingForAnswer))
        model.stop()
    }
}
