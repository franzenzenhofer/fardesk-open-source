import FardeskModels
import Foundation
import Testing

/// The 64 presets: the app's table equals the daemon contract's, and the rules that make them usable. The same
/// thresholds, with the reasons, are in `daemon/fardeskd/src/colour/palette.test.ts`.
struct LabelPaletteTests {
    private static let minimumDistance = 7.0
    private static let minimumContrast = 2.0
    private static let minimumStateDistance = 15.0
    /// System red, orange, green and grey as light, dark (StateColor): what a preset must never look like.
    private static let stateColours: [ColourMath.Channels] = [
        (255, 59, 48), (255, 69, 58), (255, 149, 0), (255, 159, 10), (52, 199, 89), (48, 209, 88), (138, 138, 142), (141, 141, 147),
    ]

    private struct FixturePreset: Decodable { let name: String; let color: String }

    private func contractFixture() throws -> [FixturePreset] {
        let url = FixtureCatalog.fixturesDirectory.appending(path: "LabelPalette/presets.json")
        return try JSONDecoder().decode([FixturePreset].self, from: Data(contentsOf: url))
    }

    private func channels(_ color: LabelColor) -> ColourMath.Channels { (color.red, color.green, color.blue) }

    @Test func theAppTableEqualsTheContractFileInOrder() throws {
        let fixture = try contractFixture()
        #expect(fixture.count == 64)
        #expect(LabelPalette.presets.map(\.name) == fixture.map(\.name))
        #expect(LabelPalette.presets.map(\.color.hex) == fixture.map(\.color))
    }

    @Test func thereAreSixtyFourDifferentPresetsWithDifferentNames() {
        #expect(LabelPalette.presets.count == 64)
        #expect(Set(LabelPalette.presets.map(\.color)).count == 64)
        #expect(Set(LabelPalette.presets.map(\.name)).count == 64)
        #expect(LabelPalette.presets.allSatisfy { !$0.name.isEmpty })
    }

    @Test func everyPairIsFarApartInCIEDE2000() {
        let colours = LabelPalette.presets.map { channels($0.color) }
        var closest = Double.infinity
        for (index, one) in colours.enumerated() {
            for two in colours[(index + 1)...] { closest = min(closest, ColourMath.deltaE2000(one, two)) }
        }
        #expect(closest >= Self.minimumDistance, "closest pair is \(closest) apart")
    }

    @Test func everyPresetIsVisibleOnWhiteAndOnBlack() {
        for preset in LabelPalette.presets {
            let colour = channels(preset.color)
            #expect(ColourMath.contrast(colour, (255, 255, 255)) >= Self.minimumContrast, "\(preset.name) on white")
            #expect(ColourMath.contrast(colour, (0, 0, 0)) >= Self.minimumContrast, "\(preset.name) on black")
        }
    }

    @Test func noPresetLooksLikeAStateColour() {
        for preset in LabelPalette.presets {
            for state in Self.stateColours {
                #expect(ColourMath.deltaE2000(channels(preset.color), state) >= Self.minimumStateDistance, "\(preset.name)")
            }
        }
    }

    @Test func theQuickPresetsAreAllInThePalette() {
        #expect(LabelPalette.quick.count == LabelPalette.quickNames.count)
        #expect(LabelPalette.quick.count >= 6)
    }

    @Test func aColourIsHashAndSixUpperCaseHexDigitsOnTheWire() throws {
        #expect(LabelColor(hex: "#1AA1FB")?.hex == "#1AA1FB")
        for bad in ["#1aa1fb", "1AA1FB", "#FFF", "#1AA1FBFF", "#12345G", "blue", ""] { #expect(LabelColor(hex: bad) == nil, "\(bad)") }
        let decoder = JSONDecoder()
        #expect(throws: DecodingError.self) { try decoder.decode([LabelColor].self, from: Data(#"["blue"]"#.utf8)) }
        #expect(try decoder.decode([LabelColor].self, from: Data(##"["#1A2B3C"]"##.utf8)).first?.red == 0x1A)
        #expect(LabelColor(red: 26, green: 43, blue: 300).hex == "#1A2BFF")
    }

    @Test func theSchemaPatternAcceptsExactlyWhatTheModelAccepts() throws {
        let url = FixtureCatalog.fixturesDirectory.deletingLastPathComponent().appending(path: "LabelRequest.schema.json")
        let schema = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let color = try #require((schema["properties"] as? [String: Any])?["color"] as? [String: Any])
        let variants = try #require(color["anyOf"] as? [[String: Any]])
        let pattern = try #require(variants.compactMap { $0["pattern"] as? String }.first)
        #expect(pattern == "^#[0-9A-F]{6}$")
    }

    @Test func aPresetKnowsItsNameAndACustomColourShowsItsCode() throws {
        let azure = try #require(LabelColor(hex: "#1AA1FB"))
        #expect(azure.displayName == "Azure")
        #expect(LabelColor(hex: "#010203")?.displayName == "#010203")
    }
}
