import FardeskStore
import Foundation
import Testing

struct ColourCodingTests {
    private func freshDefaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "fardesk.tests.\(UUID().uuidString)"))
    }

    @Test func automaticColoursAreOffByDefault() throws {
        #expect(!ColourCoding(defaults: try freshDefaults()).isAutomatic)
        #expect(!ColourCoding.defaultValue)
    }

    @Test func theSwitchIsPersistedInTheDefaultsAndSeenByANewInstance() throws {
        let defaults = try freshDefaults()
        ColourCoding(defaults: defaults).isAutomatic = false
        #expect(defaults.object(forKey: ColourCoding.key) as? Bool == false)
        #expect(ColourCoding(defaults: defaults).isAutomatic == false)
        ColourCoding(defaults: defaults).isAutomatic = true
        #expect(ColourCoding(defaults: defaults).isAutomatic)
    }
}
