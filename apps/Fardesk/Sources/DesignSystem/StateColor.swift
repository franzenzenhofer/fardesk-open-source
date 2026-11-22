import FardeskStore
import SwiftUI

/// The only place a state gets a colour (docs/design/COLOUR-CODING.md). Four colours plus the text colour for "your turn", nothing else:
/// red broken, orange needs you, green OK, grey inactive. Text and buttons stay black and white.
enum StateColor {
    static let broken = Color.red
    static let needsYou = Color.orange
    static let ok = Color.green
    static let ready = Color.primary
    static let inactive = Color.secondary

    static func color(_ tone: StateTone) -> Color {
        switch tone {
        case .broken: broken
        case .needsYou: needsYou
        case .ok: ok
        case .ready: ready
        case .inactive: inactive
        }
    }

    /// A solid fill that carries a white label at 4.5:1 or more (swipe buttons): a dark shade of the state colour,
    /// the same in light mode, dark mode and Increase Contrast. The numbers live in `SwipeFill`.
    static func fill(_ tone: StateTone) -> Color {
        switch tone {
        case .broken: Color(hex: SwipeFill.broken.hex)
        case .needsYou: Color(hex: SwipeFill.needsYou.hex)
        case .ok: Color(hex: SwipeFill.ok.hex)
        case .ready: Color(hex: SwipeFill.ready.hex)
        case .inactive: Color(hex: SwipeFill.inactive.hex)
        }
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
