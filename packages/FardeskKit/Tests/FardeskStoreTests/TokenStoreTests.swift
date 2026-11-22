import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// The behaviour every token store must have, whatever it is backed by.
private func exercise(_ store: TokenStore) throws {
    let (first, second) = (UUID(), UUID())
    #expect(try store.load(first) == nil)
    #expect(try !store.hasAnyToken())

    try store.save("token-one", first)
    try store.save("token-two", second)
    #expect(try store.load(first) == "token-one")
    #expect(try Set(store.storedMachineIDs()) == [first, second])
    #expect(try store.hasAnyToken())

    try store.save("token-one-renewed", first)
    #expect(try store.load(first) == "token-one-renewed")

    try store.delete(first)
    try store.delete(first)
    #expect(try store.load(first) == nil)
    #expect(try store.load(second) == "token-two")

    try store.deleteAll()
    try store.deleteAll()
    #expect(try store.storedMachineIDs().isEmpty)
}

struct KeychainTokenStoreTests {
    @Test func realKeychainRoundTripSavesLoadsReplacesAndDeletes() async throws {
        try await StoreSandbox.with { sandbox in
            try exercise(sandbox.keychainTokens)
        }
    }

    @Test func servicesAreIsolatedFromEachOther() async throws {
        try await StoreSandbox.with { first in
            try await StoreSandbox.with { second in
                let id = UUID()
                try first.keychainTokens.save("a", id)
                #expect(try second.keychainTokens.load(id) == nil)
                try second.keychainTokens.deleteAll()
                #expect(try first.keychainTokens.load(id) == "a")
            }
        }
    }

    @Test func keychainErrorsAreDescribed() {
        #expect(TokenStoreError.keychain(status: -25300).errorDescription?.contains("-25300") == true)
        #expect(TokenStoreError.corruptTokenFile(path: "/x").errorDescription?.contains("/x") == true)
    }
}

struct FileTokenStoreTests {
    @Test func fileStoreRoundTrip() async throws {
        try await StoreSandbox.with { try exercise($0.fileTokens) }
    }

    @Test func tokenFileIsPrivateAndHoldsNoMachineNames() async throws {
        try await StoreSandbox.with { sandbox in
            let id = UUID()
            try sandbox.fileTokens.save("secret-token", id)
            let attributes = try FileManager.default.attributesOfItem(atPath: sandbox.tokenFileURL.path)
            #expect((attributes[.posixPermissions] as? Int) == 0o600)
            let text = try String(contentsOf: sandbox.tokenFileURL, encoding: .utf8)
            #expect(text.contains(id.uuidString) && text.contains("secret-token"))
        }
    }

    @Test func corruptFileThrowsInsteadOfPretendingToBeEmpty() async throws {
        try await StoreSandbox.with { sandbox in
            try Data("not json".utf8).write(to: sandbox.tokenFileURL)
            #expect(throws: TokenStoreError.corruptTokenFile(path: sandbox.tokenFileURL.path)) {
                try sandbox.fileTokens.load(UUID())
            }
        }
    }

    @Test func defaultPathIsUnderTheConfigFolder() {
        let home = URL(filePath: "/Users/someone")
        #expect(TokenStore.defaultFileURL(environment: [:], home: home).path == "/Users/someone/.config/fardesk/tokens.json")
        #expect(TokenStore.defaultFileURL(environment: ["FARDESK_TOKENS": "/tmp/t.json"], home: home).path == "/tmp/t.json")
        #expect(TokenStore.defaultFileURL(environment: ["FARDESK_TOKENS": ""], home: home).path.hasSuffix("tokens.json"))
    }
}

struct OfflineCacheAndWipeTests {
    private func snapshot(_ endpoint: MachineEndpoint) throws -> MachineSnapshot {
        var state = MachineState(endpoint: endpoint)
        state.apply(.hello(machine: try Fixtures.machine(), sessions: [try Fixtures.session("waitingPermission")]))
        return state.snapshot
    }

    @Test func snapshotRoundTripsThroughTheCacheDirectory() async throws {
        try await StoreSandbox.with { sandbox in
            let endpoint = Fixtures.endpoint("Linux")
            let saved = try snapshot(endpoint)
            #expect(sandbox.cache.load(machineID: endpoint.id) == nil)
            try sandbox.cache.save(saved)
            #expect(sandbox.cache.load(machineID: endpoint.id) == saved)
            try Data("garbage".utf8).write(to: sandbox.cache.directory.appending(path: "\(endpoint.id.uuidString).json"))
            #expect(sandbox.cache.load(machineID: endpoint.id) == nil)
        }
    }

    @Test func restoredMachineShowsLastKnownSessionsAsOffline() throws {
        let endpoint = Fixtures.endpoint("Linux")
        var live = MachineState(endpoint: endpoint)
        live.apply(.hello(machine: try Fixtures.machine(), sessions: [try Fixtures.session("waitingPermission")]))
        let saved = live.snapshot

        var state = AppState(endpoints: [endpoint])
        try state.restore(saved)
        let restored = try state.machine(id: endpoint.id)
        #expect(restored.sessions == live.sessions)
        #expect(restored.connection == .offline(lastSeen: nil))
        var empty = AppState()
        #expect(throws: AppStateError.unknownMachine(saved.machineID)) { try empty.restore(saved) }
    }

    @Test func syncKeepsKnownMachinesAddsNewAndDropsRemoved() throws {
        let (kept, dropped, added) = (Fixtures.endpoint("A"), Fixtures.endpoint("B", host: "100.64.0.11"), Fixtures.endpoint("C", host: "100.64.0.12"))
        var state = AppState(endpoints: [kept, dropped])
        try state.apply(.hello(machine: try Fixtures.machine(), sessions: []), from: kept.id)
        state.sync(endpoints: [added, kept])
        #expect(state.machines.map(\.endpoint) == [kept, added], "machines are in list order (same rank: by name)")
        #expect(try state.machine(id: kept.id).isOnline)
    }

    @Test func wipeDeletesTokensAndCacheDirectoryAndSurvivesMissingParts() async throws {
        try await StoreSandbox.with { sandbox in
            let endpoint = Fixtures.endpoint("Linux")
            try sandbox.keychainTokens.save("secret", endpoint.id)
            try sandbox.cache.save(try snapshot(endpoint))
            let wipe = LocalWipe(tokens: sandbox.keychainTokens, cache: sandbox.cache)
            try wipe.wipe()
            #expect(try sandbox.keychainTokens.load(endpoint.id) == nil)
            #expect(!sandbox.cache.exists)
            try wipe.wipe()
        }
    }

    @Test func wipeTriesEverythingAndThrowsTheFirstFailure() async throws {
        try await StoreSandbox.with { sandbox in
            struct Boom: Error {}
            let endpoint = Fixtures.endpoint("Linux")
            try sandbox.cache.save(try snapshot(endpoint))
            let failing = TokenStore(
                load: { _ in nil }, save: { _, _ in }, delete: { _ in }, storedMachineIDs: { [] },
                deleteAll: { throw Boom() }
            )
            #expect(throws: Boom.self) { try LocalWipe(tokens: failing, cache: sandbox.cache).wipe() }
            #expect(!sandbox.cache.exists)
        }
    }
}
