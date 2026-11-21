import Foundation

/// The check marks under the user's own message, like a chat app: one check = sent, two checks = Claude got it.
/// Glyph only, no word; the words are the VoiceOver label. Neither is green (green means online/OK elsewhere).
public struct DeliveryMark: Equatable, Sendable {
    public enum Tone: Equatable, Sendable {
        /// Secondary grey (sent, not yet confirmed).
        case secondary
        /// The primary text colour (arrived at Claude).
        case primary
    }

    /// How many `checkmark` glyphs to draw (1 or 2).
    public let checks: Int
    public let tone: Tone
    public let accessibilityLabel: String

    public static let sent = DeliveryMark(checks: 1, tone: .secondary, accessibilityLabel: "Sent")
    public static let gotIt = DeliveryMark(checks: 2, tone: .primary, accessibilityLabel: Outbox.gotItLabel)

    /// The mark for a message in the outbox; nil for the other states, which keep their indicator and words.
    public static func mark(for state: PendingMessage.State) -> DeliveryMark? {
        if case .sent = state { .sent } else { nil }
    }
}

extension PendingMessage {
    public var deliveryMark: DeliveryMark? { DeliveryMark.mark(for: state) }
}
