import Foundation
import Testing

struct FixtureRoundTripTests {
    @Test(arguments: try FixtureCatalog.allFixtures())
    func fixtureSurvivesDecodeAndEncodeUnchanged(fixture: Fixture) throws {
        let codec = try #require(
            FixtureCatalog.registry[fixture.contractName],
            "No Swift type registered for contract \(fixture.contractName)"
        )
        let original = try Data(contentsOf: fixture.url)
        let reencoded = try codec(original)
        #expect(try canonicalJSON(reencoded) == canonicalJSON(original))
    }

    @Test func everyFixtureDirectoryHasARegisteredSwiftType() throws {
        let directories = try FixtureCatalog.contractDirectories().map(\.lastPathComponent)
        let unregistered = directories.filter { FixtureCatalog.registry[$0] == nil }
        #expect(unregistered.isEmpty, "Fixture directories without a Swift type: \(unregistered)")
    }

    @Test func everyRegisteredSwiftTypeHasAFixtureDirectory() throws {
        let directories = Set(try FixtureCatalog.contractDirectories().map(\.lastPathComponent))
        let withoutFixtures = FixtureCatalog.registry.keys.filter { !directories.contains($0) }
        #expect(withoutFixtures.isEmpty, "Registered types without fixtures: \(withoutFixtures)")
    }

    @Test func fixtureCatalogIsNotEmpty() throws {
        #expect(try FixtureCatalog.allFixtures().count >= 70)
    }
}
