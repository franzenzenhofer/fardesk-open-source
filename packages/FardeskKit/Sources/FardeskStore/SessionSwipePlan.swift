import FardeskModels
import Foundation

/// The swipes of a session row, as data (docs/design/STATES.md). One button per side, and nothing runs until it is
/// tapped (no full swipe). Left to right: Pin, or Unpin when pinned. Right to left: End this chat while it runs, or
/// Remove from list once it stopped. Answering, approving and stopping live in the chat, where the question is.
public struct SessionSwipePlan: Equatable, Sendable {
    public enum Action: Equatable, Sendable { case pin, unpin, end, hide }

    public let leading: [Action]
    public let trailing: [Action]

    public init(session: SessionSummary) {
        leading = [session.label.pinned ? .unpin : .pin]
        trailing = [session.status == .ended ? .hide : .end]
    }
}

/// A fill and its label colour for a swipe button, as RGB hex, with the contrast between them. Colour means state
/// (docs/design/COLOUR-CODING.md); the fills are dark shades of the state colours so the white label always passes
/// 4.5:1 (WCAG 2.2 1.4.3, https://www.w3.org/TR/WCAG22/#contrast-minimum), in light mode, dark mode and Increase Contrast.
public struct SwipeFill: Equatable, Sendable {
    public let hex: UInt32
    public static let labelHex: UInt32 = 0xFFFFFF

    public static let ok = SwipeFill(hex: 0x1B6B2F)
    public static let needsYou = SwipeFill(hex: 0x9A4A00)
    public static let broken = SwipeFill(hex: 0xB3261E)
    public static let ready = SwipeFill(hex: 0x1C1C1E)
    public static let inactive = SwipeFill(hex: 0x4A4A4A)
    public static let all: [SwipeFill] = [ok, needsYou, broken, ready, inactive]

    /// WCAG relative-luminance contrast ratio of the white label on this fill.
    public var contrast: Double {
        let fill = Self.luminance(hex)
        let label = Self.luminance(Self.labelHex)
        return (max(fill, label) + 0.05) / (min(fill, label) + 0.05)
    }

    static func luminance(_ hex: UInt32) -> Double {
        func channel(_ shift: UInt32) -> Double {
            let value = Double((hex >> shift) & 0xFF) / 255
            return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }
}
