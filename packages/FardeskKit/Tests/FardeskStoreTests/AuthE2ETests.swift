import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private func list(_ names: [(String, TestDaemon)]) -> MachineList {
    MachineList(endpoints: names.map { MachineEndpoint(name: $0.0, url: $0.1.url) })
}

/// A device token for `daemon`, the one way there is: a one-time code from the daemon, exchanged.
private func pairedToken(_ daemon: TestDaemon, deviceName: String, access: MachineAccess) async throws -> String {
    let link = try await PairingLinks.make(for: daemon, name: "box")
    return try await PairingExchange.token(for: PairingLink.parse(link), deviceName: deviceName, access: access)
}

/// One real daemon, a sandbox, and an `AuthSession` over the real keychain.
private func withAuth(_ body: (AuthSession, TestDaemon, StoreSandbox) async throws -> Void) async throws {
    try await TestDaemon.with { daemon in
        try await StoreSandbox.with { sandbox in
            let session = AuthSession(access: MachineAccess(tokens: sandbox.keychainTokens, timeout: 5))
            try await body(session, daemon, sandbox)
        }
    }
}

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AuthSessionE2ETests {
    @Test func aPairedTokenOpensTheMachineAndIsNotTheConfigToken() async throws {
        try await withAuth { auth, daemon, _ in
            let machines = list([("box", daemon)])
            let token = try await pairedToken(daemon, deviceName: "Test Phone", access: auth.access)
            try auth.access.tokens.save(token, machines.endpoints[0].id)
            #expect(try auth.isLoggedIn())
            let api = try auth.access.api(for: machines.endpoints[0])
            #expect(try await api.machine().name == "test-box")
            #expect(api.token != TestDaemon.token)
            let devices = try await api.authDevices().devices
            #expect(devices.contains { $0.name == "Test Phone" && $0.current })
        }
    }

    @Test func withoutAPairedTokenThereIsNoLogin() async throws {
        try await withAuth { auth, _, _ in
            let loggedIn = try auth.isLoggedIn()
            #expect(!loggedIn)
        }
    }

    @Test func logoutRevokesTheTokenOnTheMachineAndDeletesItLocally() async throws {
        try await withAuth { auth, daemon, _ in
            let machines = list([("box", daemon)])
            try auth.access.tokens.save(try await pairedToken(daemon, deviceName: "x", access: auth.access), machines.endpoints[0].id)
            let api = try auth.access.api(for: machines.endpoints[0])
            let results = try await auth.logout(apnsToken: nil, machines: machines)
            #expect(results == [MachineLogoutResult(machine: "box", problem: nil)])
            let loggedIn = try auth.isLoggedIn()
            #expect(!loggedIn)
            let error = try await #require(throws: FardeskAPIError.self) { _ = try await api.machine() }
            #expect(error.isTokenRevoked)
            let none = try await auth.logout(apnsToken: nil, machines: machines)
            #expect(none.isEmpty)
        }
    }

    @Test func logoutReportsAnUnreachableMachineButStillDeletesTheToken() async throws {
        try await StoreSandbox.with { sandbox in
            let dead = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
            try sandbox.keychainTokens.save("t", dead.id)
            let auth = AuthSession(access: MachineAccess(tokens: sandbox.keychainTokens, timeout: 2))
            let results = try await auth.logout(apnsToken: nil, machines: MachineList(endpoints: [dead]))
            #expect(results.first?.problem != nil)
            let loggedIn = try auth.isLoggedIn()
            #expect(!loggedIn)
        }
    }
}

/// A started model that has no machine yet, on a real daemon.
@MainActor
private func withNewApp(_ body: (AppModel, StoreSandbox, TestDaemon) async throws -> Void) async throws {
    try await TestDaemon.with { daemon in
        try await StoreSandbox.with { sandbox in
            try await body(AppModel(configuration: sandbox.configuration()), sandbox, daemon)
        }
    }
}

/// A paired model on a real daemon: link scanned, machine online.
@MainActor
private func withPairedApp(_ body: (AppModel, StoreSandbox, TestDaemon) async throws -> Void) async throws {
    try await withNewApp { app, sandbox, daemon in
        await app.start()
        await app.pair(link: try await PairingLinks.make(for: daemon, name: "box"))
        _ = try await waitUntil { await MainActor.run { app.state.machines.first?.isOnline == true } }
        try await body(app, sandbox, daemon)
    }
}

@MainActor
private func expectWiped(_ app: AppModel, _ sandbox: StoreSandbox) throws {
    #expect(app.phase == .loggedOut)
    let anyToken = try sandbox.keychainTokens.hasAnyToken()
    #expect(!anyToken)
    #expect(!sandbox.cache.exists)
    // Machines exist only through pairing (#63): a wipe forgets them, so nothing is left to show sessions for.
    #expect(app.machines.endpoints.isEmpty)
    #expect(app.state.machines.allSatisfy { $0.sessions.isEmpty })
}

@MainActor
@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AppModelAuthE2ETests {
    @Test func pairingLeadsToReadyAndALaterLaunchStaysPaired() async throws {
        try await withNewApp { app, sandbox, daemon in
            await app.start()
            #expect(app.phase == .loggedOut)
            let wrong = try PairingLinks.make(url: daemon.url, name: "box", code: String(repeating: "x", count: 43))
            await app.pair(link: wrong)
            #expect(app.phase == .loggedOut && app.loginError?.hasPrefix("Pairing failed") == true)
            await app.pair(link: try await PairingLinks.make(for: daemon, name: "box"))
            #expect(app.phase == .ready && app.loginError == nil)
            app.stop()
            let relaunched = AppModel(configuration: sandbox.configuration())
            await relaunched.start()
            #expect(relaunched.phase == .ready)
            relaunched.stop()
        }
    }

    @Test func logoutWipesTokensCacheAndState() async throws {
        try await withPairedApp { app, sandbox, _ in
            await app.logout(apnsToken: nil)
            try expectWiped(app, sandbox)
        }
    }

    @Test func revokingTheDeviceMakesTheNextRequestWipeEverything() async throws {
        try await withPairedApp { app, sandbox, _ in
            app.cacheWriter.flush()
            #expect(sandbox.cache.exists)
            #expect(await app.revoke(device: nil, on: app.machines.endpoints[0].id) != nil)
            await app.refresh()
            try expectWiped(app, sandbox)
            #expect(app.loginError?.contains("signed out") == true)
        }
    }

    @Test func revokedTokenSeenByTheStreamAfterAReconnectWipesToo() async throws {
        try await withPairedApp { app, sandbox, daemon in
            let master = daemon.api(token: TestDaemon.token, timeout: 5)
            _ = try await master.revoke(device: nil)
            await daemon.stopServer()
            try await daemon.launch()
            let wiped = try await waitUntil(timeout: .seconds(20)) { await MainActor.run { app.phase == .loggedOut } }
            #expect(wiped)
            try expectWiped(app, sandbox)
        }
    }

    @Test func devicesListsThePairedDevice() async throws {
        try await withPairedApp { app, _, _ in
            let devices = await app.devices()
            #expect(devices.first?.devices.contains { $0.name == "Test Device" && $0.current } == true)
            app.stop()
        }
    }
}
