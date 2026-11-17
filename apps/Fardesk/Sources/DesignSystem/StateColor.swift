import FardeskStore
import SwiftUI

/// The only place a state gets a colour (docs/design/COLOUR-CODING.md). Four colours, nothing else:
/// red broken, orange needs you, green OK, grey inactive. Text and buttons stay black and white.
enum StateColor {
    static let broken = Color.red
    static let needsYou = Color.orange
    static let ok = Color.green
    static let inactive = Color.secondary

    static func color(_ tone: StateTone) -> Color {
        switch tone {
        case .broken: broken
        case .needsYou: needsYou
        case .ok: ok
        case .inactive: inactive
        }
    }

    /// The status word under the session title.
    static func color(_ tone: SessionHeaderLine.Tone) -> Color { color(tone.state) }
}
