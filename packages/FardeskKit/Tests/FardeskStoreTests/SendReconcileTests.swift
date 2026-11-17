import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Observation
import Testing

/// The run-4 findings: a repeated text must not be mistaken for the old row, and the New Session sheet reads a small list.
@MainActor
struct SendReconcileTests {
    @Test func aRowThatWasAlreadyThereIsNeverTheMessageArriving() throws {
        let ref = SessionRef(machineID: UUID(), sessionID: "s")
        let sentAt = Date()
        let old = try Fixtures.userRow("Reply only: ok", id: "first-prompt", at: sentAt.addingTimeInterval(-5))
        var outbox = Outbox()
        let id = outbox.add(OutgoingMessage(text: "Reply only: ok"), to: ref, kind: .reply, at: sentAt, knownRows: ["first-prompt"])
        outbox.reconcile(ref, rows: [old])
        #expect(outbox.message(id) != nil && !outbox.isDelivered(rowID: "first-prompt"), "the first prompt has the same words but was there before")
        let arrived = try Fixtures.userRow("Reply only: ok", id: "second", at: sentAt.addingTimeInterval(1))
        outbox.reconcile(ref, rows: [old, arrived])
        #expect(outbox.message(id) == nil && outbox.isDelivered(rowID: "second") && !outbox.isDelivered(rowID: "first-prompt"))
    }

    @Test func theSameWordsSentTwiceThroughARealHubMarkTheNewRowOnly() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                let model = try await sandbox.startedHubModel(for: rig)
                let peer = HubIdentity.machineID(name: HubRig.peerName)
                _ = try await waitUntil { await MainActor.run { (try? model.state.machine(id: peer))?.isOnline == true } }
                let ref = SessionRef(machineID: peer, sessionID: SeedSession.hookSessionID)
                await model.openSession(ref)
                let existing = model.feeds.feed(for: SessionRef(machineID: peer, sessionID: ref.sessionID)).activities.compactMap { row -> (String, String)? in
                    if case .user(let user) = row { (user.id, user.text) } else { nil }
                }
                let (oldID, text) = try #require(existing.first)
                _ = await model.submit(OutgoingMessage(text: text), to: ref)
                #expect(model.outbox.pending(for: ref).count == 1)
                try await Task.sleep(for: .milliseconds(300))
                #expect(model.outbox.pending(for: ref).count == 1, "the old row with the same words does not settle it")
                try rig.peer.appendUserPrompt(text, toSession: SeedSession.hookSessionID)
                let settled = try await waitUntil { await MainActor.run { model.outbox.pending(for: ref).isEmpty } }
                #expect(settled && !model.outbox.isDelivered(rowID: oldID))
                model.stop()
            }
        }
    }

    @Test func theNewSessionSheetsListChangesWhenMachinesChangeNotWhenActivityFlows() async throws {
        try await StoreSandbox.with { sandbox in
            let endpoint = Fixtures.endpoint("Studio")
            var list = MachineList()
            list.add(endpoint)
            try sandbox.machinesFile.save(list)
            try sandbox.keychainTokens.save("token", endpoint.id)
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            #expect(model.onlineMachines.isEmpty)
            model.apply(try Fixtures.event("helloWithSessions"), from: endpoint.id)
            #expect(model.onlineMachines.map(\.name) == ["Studio"] && model.onlineMachines.first?.models.isEmpty == false)

            let woken = Woken()
            withObservationTracking { _ = model.onlineMachines } onChange: { woken.hit() }
            model.apply(try Fixtures.event("activity_assistant"), from: endpoint.id)
            model.apply(.ping(ts: Date().addingTimeInterval(60)), from: endpoint.id)
            #expect(!woken.fired, "activity and pings do not rebuild the sheet")
            model.markOffline(endpoint.id)
            #expect(model.onlineMachines.isEmpty && woken.fired)
            model.stop()
        }
    }
}

private final class Woken: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false
    func hit() { lock.withLock { flag = true } }
    var fired: Bool { lock.withLock { flag } }
}
