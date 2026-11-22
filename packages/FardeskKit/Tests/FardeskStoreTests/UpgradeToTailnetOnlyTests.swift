import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// An app updated from a build that saved machines over https with a pin starts clean once, explains why, and
/// keeps nothing of the old setup.
@MainActor
struct UpgradeToTailnetOnlyTests {
    @Test func machinesSavedBeforeTailnetOnlyStartCleanWithTheReason() async throws {
        try await StoreSandbox.with { sandbox in
            let old = #"{"endpoints":[{"id":"11111111-1111-4111-8111-111111111111","name":"Desk","url":"https://100.64.0.10:4780","pin":"sha256/47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="}]}"#
            try Data(old.utf8).write(to: sandbox.machinesFile.url)
            let app = AppModel(configuration: sandbox.configuration())
            await app.start()
            #expect(app.phase == .loggedOut)
            #expect(app.loginError == AppModel.repairReason)
            #expect(app.machines.endpoints.isEmpty)
            #expect(try sandbox.machinesFile.load().endpoints.isEmpty)
            #expect(try !sandbox.keychainTokens.hasAnyToken())
            app.stop()
        }
    }
}
