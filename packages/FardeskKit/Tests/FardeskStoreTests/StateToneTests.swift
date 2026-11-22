import FardeskModels
@testable import FardeskStore
import Testing

/// The colour rule of docs/design/COLOUR-CODING.md: red broken, orange needs you, green OK, grey inactive.
struct StateToneTests {
    @Test func aWorkingSessionIsGreenNotBlue() {
        #expect(StateTone(status: .working) == .ok)
        #expect(StateTone(status: .waiting) == .needsYou)
        #expect(StateTone(status: .idle) == .ready, "your turn is black, not grey like stopped")
        #expect(StateTone(status: .ended) == .inactive)
    }

    @Test func machineConnections() {
        #expect(StateTone(connection: .online) == .ok)
        #expect(StateTone(connection: .connecting) == .inactive)
        #expect(StateTone(connection: .offline(lastSeen: nil)) == .inactive)
        #expect(StateTone(connection: .loggedOut) == .needsYou)
    }

    @Test func anUnreachableHubIsBroken() {
        #expect(StateTone(hub: .reachable) == .ok)
        #expect(StateTone(hub: .connecting) == .inactive)
        #expect(StateTone(hub: .unreachable(reason: "timeout")) == .broken)
    }

    @Test func outboxStates() {
        #expect(StateTone(outbox: .queued(waitingFor: nil)) == .inactive)
        #expect(StateTone(outbox: .queued(waitingFor: "Mac")) == .inactive)
        #expect(StateTone(outbox: .sending) == .inactive)
        #expect(StateTone(outbox: .sent) == .ok)
        #expect(StateTone(outbox: .failed("offline")) == .broken)
    }

    @Test func noticesAndSteps() {
        #expect(StateTone(notice: .running) == .inactive)
        #expect(StateTone(notice: .succeeded) == .ok)
        #expect(StateTone(notice: .failed) == .broken)
        #expect(StateTone(notice: .info) == .inactive)
        #expect(StateTone(step: .running) == .inactive)
        #expect(StateTone(step: .done) == .ok)
        #expect(StateTone(step: .failed("not found")) == .broken)
    }

}
