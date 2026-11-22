import FardeskModels
import SwiftUI
#if os(iOS)
import UIKit
#endif

extension LabelColor {
    /// The colour on screen. A label colour is one fixed colour; the presets are all visible on white and on
    /// black (`LabelPaletteTests`), and a colour from the system picker is the user's own choice.
    var swatch: Color {
        Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: 1)
    }

    /// Black or white for a mark drawn on top of the colour (the check on the picked colour): text stays black or white.
    var markColor: Color {
        let brightness = (299 * red + 587 * green + 114 * blue) / 1000
        return brightness < 140 ? .white : .black
    }

    /// The colour the system picker returned, rounded to 8 bits per channel.
    init(_ color: Color, in environment: EnvironmentValues) {
        let resolved = color.resolve(in: environment)
        self.init(
            red: Int((resolved.red * 255).rounded()),
            green: Int((resolved.green * 255).rounded()),
            blue: Int((resolved.blue * 255).rounded())
        )
    }

    /// A dot in the colour itself for a menu: menus draw symbols in one colour, so on iOS the dot is an image with
    /// its colour baked in.
    var menuDot: Image {
        #if os(iOS)
        let base = UIImage(systemName: "circle.fill") ?? UIImage()
        return Image(uiImage: base.withTintColor(UIColor(swatch), renderingMode: .alwaysOriginal))
        #else
        return Image(systemName: "circle.fill")
        #endif
    }
}
