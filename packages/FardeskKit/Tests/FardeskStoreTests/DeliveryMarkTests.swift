import Testing

@testable import FardeskStore

@Suite("Delivery marks under the user's own messages")
struct DeliveryMarkTests {
    @Test("Sent is one grey check with the label Sent")
    func sentIsOneCheck() {
        let mark = DeliveryMark.mark(for: .sent)
        #expect(mark == DeliveryMark(checks: 1, tone: .secondary, accessibilityLabel: "Sent"))
    }

    @Test("In the session is one blue check")
    func deliveredIsOneBlueCheck() {
        #expect(DeliveryMark.mark(for: .delivered) == DeliveryMark(checks: 1, tone: .blue, accessibilityLabel: "Delivered"))
    }

    @Test("Claude got it is two blue checks")
    func gotItIsTwoChecks() {
        #expect(DeliveryMark.gotIt == DeliveryMark(checks: 2, tone: .blue, accessibilityLabel: "Claude got it"))
        #expect(DeliveryMark.gotIt.checks > DeliveryMark.delivered.checks)
    }

    @Test("Queued, sending and failed have no check mark: they keep their own indicator and words")
    func otherStatesHaveNoMark() {
        for state: PendingMessage.State in [.queued(waitingFor: nil), .queued(waitingFor: "Linux"), .sending, .failed("no route")] {
            #expect(DeliveryMark.mark(for: state) == nil)
        }
    }
}
