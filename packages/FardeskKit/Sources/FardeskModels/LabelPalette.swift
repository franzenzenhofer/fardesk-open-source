import Foundation

/// The 64 preset colours, in picker (hue) order. The daemon contract defines them once
/// (`daemon/fardeskd/src/contract/palette.ts`, generated into `schema/fixtures/LabelPalette/presets.json`);
/// `LabelPaletteTests` compares this table with that file. Never red, orange, green or grey: those mean state.
public enum LabelPalette {
    public static let presets: [LabelPreset] = table.map { name, hex in
        guard let color = LabelColor(hex: hex) else { preconditionFailure("palette entry \(name) is not #RRGGBB: \(hex)") }
        return LabelPreset(name: name, color: color)
    }

    /// The presets the long-press menu shows: one clearly different colour per family, so a swipe picks fast.
    public static let quickNames = ["Azure", "Jade", "Indigo", "Violet", "Magenta", "Cerise", "Teal", "Lavender"]

    public static var quick: [LabelPreset] { quickNames.compactMap { name in presets.first { $0.name == name } } }

    private static let table: [(String, String)] = [
        ("Burgundy", "#8E0443"),
        ("Dusty Rose", "#AD6879"),
        ("Blush", "#E197A5"),
        ("Wine", "#7D3C47"),
        ("Raspberry", "#B83958"),
        ("Rosewood", "#98545F"),
        ("Cerise", "#FD0568"),
        ("Flamingo", "#FD6988"),
        ("Spruce", "#045B45"),
        ("Jade", "#0B9371"),
        ("Seafoam", "#5AA48A"),
        ("Fir", "#237A69"),
        ("Turquoise", "#39BFA4"),
        ("Teal", "#389489"),
        ("Peacock", "#078488"),
        ("Lagoon", "#44AAAC"),
        ("Capri", "#35B9DB"),
        ("Lake", "#2D91AF"),
        ("Petrol", "#057698"),
        ("Sky", "#70B2DE"),
        ("Deep Sea", "#105A84"),
        ("Steel Blue", "#487BA9"),
        ("Azure", "#1AA1FB"),
        ("Periwinkle", "#95ABE0"),
        ("Cornflower", "#628EED"),
        ("Navy", "#31447C"),
        ("Cobalt", "#0449B3"),
        ("Slate Blue", "#5963A9"),
        ("Royal Blue", "#135FE2"),
        ("Bluebell", "#5774E6"),
        ("Dusk", "#7A7DB1"),
        ("Iris", "#867AFA"),
        ("Wisteria", "#A899FA"),
        ("Indigo", "#3B2EB6"),
        ("Twilight", "#4C3F6D"),
        ("Ultraviolet", "#654DE7"),
        ("Amethyst", "#8068C4"),
        ("Lilac", "#B4A3D8"),
        ("Grape", "#684A97"),
        ("Heather", "#826898"),
        ("Lavender", "#A479CA"),
        ("Violet", "#BA75FE"),
        ("Plum", "#60327B"),
        ("Purple", "#8F36C5"),
        ("Bright Purple", "#B452EF"),
        ("Orchid", "#D490F7"),
        ("Eggplant", "#760996"),
        ("Wild Orchid", "#9F5DB3"),
        ("Damson", "#643E67"),
        ("Boysenberry", "#954393"),
        ("Cyclamen", "#C75DC4"),
        ("Thistle", "#B687B2"),
        ("Fuchsia", "#F459F2"),
        ("Mulberry", "#7E1B6A"),
        ("Magenta", "#DA04B7"),
        ("Mauve", "#AE629A"),
        ("Bubblegum", "#E590C6"),
        ("Antique Mauve", "#8A5171"),
        ("Merlot", "#742E53"),
        ("Hot Pink", "#F726A7"),
        ("Candy Pink", "#F965B5"),
        ("Ruby", "#AE006A"),
        ("Rose Pink", "#C8789A"),
        ("Peony", "#D53781"),
    ]
}
