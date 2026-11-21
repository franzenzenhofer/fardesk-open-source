import Testing

@testable import FardeskStore

@Suite("Delivery marks under the user's own messages")
struct DeliveryMarkTests {
    @Test("Sent is one grey check with the label Sent")
    func sentIsOneCheck() {
        let mark = DeliveryMark.mark(for: .sent)
        #expect(mark == DeliveryMark(checks: 1, tone: .secondary, accessibilityLabel: "Sent"))
    }

    @Test("Claude got it is two checks in the primary colour")
    func gotItIsTwoChecks() {
        #expect(DeliveryMark.gotIt == DeliveryMark(checks: 2, tone: .primary, accessibilityLabel: "Claude got it"))
        #expect(DeliveryMark.gotIt.checks > DeliveryMark.sent.checks)
    }

    @Test("Queued, sending, failed and held have no check mark: they keep their own indicator and words")
    func otherStatesHaveNoMark() {
        for state: PendingMessage.State in [.queued(waitingFor: nil), .queued(waitingFor: "Linux"), .sending, .failed("no route"), .held] {
            #expect(DeliveryMark.mark(for: state) == nil)
        }
    }
}
