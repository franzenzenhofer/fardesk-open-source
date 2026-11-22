import Foundation

/// The check marks under the user's own message (owner, 2026-11-22): one grey check = the computer took it, one blue
/// check = it is in the Claude session, two blue checks = Claude read it (it is in the transcript). Glyph only, no word;
/// the words are the VoiceOver label. Blue is used for these checks only (docs/design/COLOUR-CODING.md).
public struct DeliveryMark: Equatable, Sendable {
    public enum Tone: Equatable, Sendable {
        /// Secondary grey: on the computer, waiting for Claude's current turn.
        case secondary
        /// Blue: in the session, or read.
        case blue
    }

    /// How many `checkmark` glyphs to draw (1 or 2).
    public let checks: Int
    public let tone: Tone
    public let accessibilityLabel: String

    public static let sent = DeliveryMark(checks: 1, tone: .secondary, accessibilityLabel: "Sent")
    public static let delivered = DeliveryMark(checks: 1, tone: .blue, accessibilityLabel: "Delivered")
    public static let gotIt = DeliveryMark(checks: 2, tone: .blue, accessibilityLabel: Outbox.gotItLabel)

    /// The mark for a message in the outbox; nil for the other states, which keep their indicator and words.
    public static func mark(for state: PendingMessage.State) -> DeliveryMark? {
        switch state {
        case .sent: .sent
        case .delivered: .delivered
        default: nil
        }
    }
}

extension PendingMessage {
    public var deliveryMark: DeliveryMark? { DeliveryMark.mark(for: state) }
}
