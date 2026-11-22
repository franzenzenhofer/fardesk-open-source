import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Settings > Danger zone: "Reset Fardesk" leaves nothing of the owner's choices on the device.
@MainActor
struct ResetFardeskTests {
    private static let savedKeys: [String] = NotificationPreferences.allTypes.map(NotificationPreferences.key(for:)) + [
        ColourCoding.key, "voice.readAloud", "voice.handsFree", "voice.attachRecording", "requireFaceID", "apnsToken"
    ]

    private func freshSettings() throws -> (SavedSettings, UserDefaults) {
        let name = "fardesk.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        return (SavedSettings(defaults: defaults, domain: name), defaults)
    }

    /// One paired machine (no daemon behind it) with a token, as the device keeps it.
    private static func pairOneMachine(in sandbox: StoreSandbox) throws -> MachineEndpoint {
        let dead = MachineEndpoint(name: "Studio", url: try #require(URL(string: "http://127.0.0.1:9")))
        var list = MachineList()
        list.add(dead)
        try sandbox.machinesFile.save(list)
        try sandbox.keychainTokens.save("t", dead.id)
        return dead
    }

    @Test func resetDeletesEverySavedSettingTheCacheTheOrderAndTheMachines() async throws {
        try await StoreSandbox.with { sandbox in
            let dead = try Self.pairOneMachine(in: sandbox)
            try sandbox.machineOrderFile.save(["Studio"])
            try sandbox.cache.saveFeed(FeedSnapshot(activities: [], nextBefore: nil), machineID: dead.id, sessionID: "s1")
            let (settings, defaults) = try freshSettings()
            for key in Self.savedKeys { defaults.set(true, forKey: key) }
            #expect(Set(settings.keys) == Set(Self.savedKeys))

            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            await model.resetFardesk(apnsToken: nil, settings: settings)

            for key in Self.savedKeys { #expect(defaults.object(forKey: key) == nil, "\(key) survived the reset") }
            #expect(settings.keys.isEmpty)
            #expect(model.phase == .loggedOut)
            #expect(model.needsOnboarding)
            #expect(model.machines.endpoints.isEmpty)
            #expect(model.state.machineOrder.isEmpty)
            #expect(try sandbox.machineOrderFile.load().isEmpty)
            #expect(!FileManager.default.fileExists(atPath: sandbox.machineOrderFile.url.path))
            #expect(!sandbox.cache.exists)
            let anyToken = try sandbox.keychainTokens.hasAnyToken()
            #expect(!anyToken)
            #expect(model.configuration.telemetry.isEmpty)
        }
    }

    @Test func clearingTheCacheKeepsTheMachinesAndTokens() async throws {
        try await StoreSandbox.with { sandbox in
            let dead = try Self.pairOneMachine(in: sandbox)
            try sandbox.cache.saveFeed(FeedSnapshot(activities: [], nextBefore: nil), machineID: dead.id, sessionID: "s1")
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            model.clearCachedChats()
            #expect(!sandbox.cache.exists)
            #expect(model.machines.endpoints.count == 1)
            let anyToken = try sandbox.keychainTokens.hasAnyToken()
            #expect(anyToken)
            model.stop()
        }
    }

    @Test func diagnosticsNameTheVersionAndEveryMachineButNeverItsAddress() async throws {
        try await StoreSandbox.with { sandbox in
            let (model, _) = try await sandbox.startedModelWithSessions()
            let text = model.diagnosticsText()
            #expect(text.contains("Fardesk 9.9 (99)"))
            #expect(text.contains("Studio"))
            #expect(!text.contains("http://"))
            model.stop()
        }
    }
}
