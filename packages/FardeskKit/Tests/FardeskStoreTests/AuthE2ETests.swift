import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// A password made for this run only; nothing real is ever hardcoded.
func freshPassword() -> String { "pw-" + UUID().uuidString.lowercased() }

private func list(_ names: [(String, TestDaemon)]) -> MachineList {
    MachineList(endpoints: names.map { MachineEndpoint(name: $0.0, url: $0.1.url) })
}

/// One real daemon with a fresh password, a sandbox, and an `AuthSession` over the real keychain.
private func withAuth(
    configOverrides: [String: any Sendable] = [:],
    timeout: TimeInterval = 5,
    _ body: (AuthSession, TestDaemon, String) async throws -> Void
) async throws {
    let password = freshPassword()
    try await TestDaemon.with(configOverrides: configOverrides, password: password) { daemon in
        try await StoreSandbox.with { sandbox in
            let session = AuthSession(access: MachineAccess(tokens: sandbox.keychainTokens, timeout: timeout))
            try await body(session, daemon, password)
        }
    }
}

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AuthSessionE2ETests {
    @Test func loginStoresATokenThatOpensTheMachine() async throws {
        try await withAuth { auth, daemon, password in
            let machines = list([("box", daemon)])
            let outcome = await auth.login(password: password, deviceName: "Test Phone", machines: machines)
            #expect(outcome.succeeded)
            #expect(outcome.results.map(\.status) == [.success])
            #expect(try auth.isLoggedIn())
            let api = try auth.access.api(for: machines.endpoints[0])
            #expect(try await api.machine().name == "test-box")
            #expect(api.token != TestDaemon.token)
            let devices = try await api.authDevices().devices
            #expect(devices.contains { $0.name == "Test Phone" && $0.current })
        }
    }

    @Test func wrongPasswordStoresNothing() async throws {
        try await withAuth { auth, daemon, _ in
            let outcome = await auth.login(password: "wrong-password", deviceName: "x", machines: list([("box", daemon)]))
            #expect(!outcome.succeeded)
            #expect(outcome.results.map(\.status) == [.wrongPassword])
            #expect(outcome.failureMessage == "Wrong password.")
            let loggedIn = try auth.isLoggedIn()
            #expect(!loggedIn)
        }
    }

    @Test func tooManyWrongPasswordsAreRateLimited() async throws {
        let limits = ["passwordHash": NSNull(), "maxFailures": 2, "windowSeconds": 300] as [String: any Sendable]
        try await withAuth(configOverrides: ["auth": limits]) { auth, daemon, _ in
            var last = LoginStatus.success
            for _ in 0..<5 {
                last = await auth.login(password: "nope", deviceName: "x", machines: list([("box", daemon)])).results[0].status
            }
            #expect(last == .rateLimited)
            let outcome = await auth.login(password: "nope", deviceName: "x", machines: list([("box", daemon)]))
            #expect(outcome.failureMessage.hasPrefix("Too many attempts"))
        }
    }

    @Test func unreachableMachineDoesNotFailTheOthers() async throws {
        try await withAuth(timeout: 3) { auth, daemon, password in
            let dead = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
            let machines = MachineList(endpoints: [dead, MachineEndpoint(name: "box", url: daemon.url)])
            let outcome = await auth.login(password: password, deviceName: "x", machines: machines)
            #expect(outcome.succeeded)
            #expect(outcome.results.map(\.endpoint.name) == ["dead", "box"])
            #expect(!outcome.results[0].statusText.isEmpty)
            #expect(outcome.results[1].succeeded)
            let stored = try auth.access.tokens.storedMachineIDs()
            #expect(stored == [machines.endpoints[1].id])
            #expect(outcome.failureMessage == "Cannot reach dead.")
        }
    }

    @Test func peersAreMergedAndLoggedInWithTheSamePassword() async throws {
        try await withAuth { auth, second, password in
            let peers: [[String: String]] = [["name": "Second Box", "url": second.url.absoluteString]]
            try await TestDaemon.with(configOverrides: ["peers": peers], password: password) { first in
                let outcome = await auth.login(password: password, deviceName: "x", machines: list([("First", first)]))
                #expect(outcome.machines.endpoints.map(\.name) == ["First", "Second Box"])
                #expect(outcome.results.map(\.status) == [.success, .success])
                let stored = try auth.access.tokens.storedMachineIDs()
                #expect(stored.count == 2)
                let again = await auth.login(password: password, deviceName: "x", machines: outcome.machines)
                #expect(again.machines.endpoints.count == 2)
            }
        }
    }

    @Test func addingAMachineKeepsItOnlyWhenThePasswordIsRight() async throws {
        try await withAuth { auth, daemon, password in
            let rejected = await auth.add(url: daemon.url, name: "New", password: "wrong", deviceName: "x", machines: MachineList())
            #expect(rejected.machines.endpoints.isEmpty && !rejected.succeeded)
            let named = await auth.add(url: daemon.url, name: "New", password: password, deviceName: "x", machines: MachineList())
            #expect(named.machines.endpoints.map(\.name) == ["New"])
            let unnamed = await auth.add(url: daemon.url, name: "", password: password, deviceName: "x", machines: MachineList())
            #expect(unnamed.machines.endpoints.map(\.name) == ["127.0.0.1"])
        }
    }

    @Test func logoutRevokesTheTokenOnTheMachineAndDeletesItLocally() async throws {
        try await withAuth { auth, daemon, password in
            let machines = list([("box", daemon)])
            _ = await auth.login(password: password, deviceName: "x", machines: machines)
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

extension MachineLoginResult {
    /// The reason text inside an `.unreachable` status.
    var statusText: String {
        if case .unreachable(let why) = status { why } else { "" }
    }
}

/// A model that knows one real daemon (with a fresh password) but has not started yet.
@MainActor
private func withNewApp(_ body: (AppModel, StoreSandbox, TestDaemon, String) async throws -> Void) async throws {
    let password = freshPassword()
    try await TestDaemon.with(password: password) { daemon in
        try await StoreSandbox.with { sandbox in
            try sandbox.machinesFile.save(list([("box", daemon)]))
            try await body(AppModel(configuration: sandbox.configuration()), sandbox, daemon, password)
        }
    }
}

/// A logged-in model on a real daemon: login done, machine online.
@MainActor
private func withLoggedInApp(_ body: (AppModel, StoreSandbox, TestDaemon, String) async throws -> Void) async throws {
    try await withNewApp { app, sandbox, daemon, password in
        await app.start()
        await app.login(password: password)
        _ = try await waitUntil { await MainActor.run { app.state.machines[0].isOnline } }
        try await body(app, sandbox, daemon, password)
    }
}

@MainActor
private func expectWiped(_ app: AppModel, _ sandbox: StoreSandbox) throws {
    #expect(app.phase == .loggedOut)
    let anyToken = try sandbox.keychainTokens.hasAnyToken()
    #expect(!anyToken)
    #expect(!sandbox.cache.exists)
    #expect(app.state.machines[0].sessions.isEmpty)
}

@MainActor
@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AppModelAuthE2ETests {
    @Test func loginLeadsToReadyAndALaterLaunchStaysLoggedIn() async throws {
        try await withNewApp { app, sandbox, _, password in
            await app.start()
            #expect(app.phase == .loggedOut)
            await app.login(password: "wrong")
            #expect(app.phase == .loggedOut && app.loginError == "Wrong password.")
            await app.login(password: password)
            #expect(app.phase == .ready && app.loginError == nil)
            app.stop()
            let relaunched = AppModel(configuration: sandbox.configuration())
            await relaunched.start()
            #expect(relaunched.phase == .ready)
            relaunched.stop()
        }
    }

    @Test func logoutWipesTokensCacheAndState() async throws {
        try await withLoggedInApp { app, sandbox, _, _ in
            await app.logout(apnsToken: nil)
            try expectWiped(app, sandbox)
        }
    }

    @Test func addMachineJoinsTheListAndRejectsAWrongPassword() async throws {
        let password = freshPassword()
        try await TestDaemon.with(password: password) { daemon in
            try await StoreSandbox.with { sandbox in
                let app = AppModel(configuration: sandbox.configuration())
                #expect(await !app.addMachine(url: daemon.url, name: "Extra", password: "wrong"))
                #expect(app.lastError == "Extra: could not add the machine: Wrong password.")
                #expect(await app.addMachine(url: daemon.url, name: "Extra", password: password))
                #expect(app.machines.endpoints.map(\.name) == ["Extra"])
                app.stop()
            }
        }
    }

    @Test func revokingTheDeviceMakesTheNextRequestWipeEverything() async throws {
        try await withLoggedInApp { app, sandbox, _, _ in
            #expect(sandbox.cache.exists)
            #expect(await app.revoke(device: nil, on: app.machines.endpoints[0].id) != nil)
            await app.refresh()
            try expectWiped(app, sandbox)
            #expect(app.loginError?.contains("signed out") == true)
        }
    }

    @Test func revokedTokenSeenByTheStreamAfterAReconnectWipesToo() async throws {
        try await withLoggedInApp { app, sandbox, daemon, _ in
            let master = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            _ = try await master.revoke(device: nil)
            await daemon.stopServer()
            try await daemon.launch()
            let wiped = try await waitUntil(timeout: .seconds(20)) { await MainActor.run { app.phase == .loggedOut } }
            #expect(wiped)
            try expectWiped(app, sandbox)
        }
    }

    @Test func devicesListsTheLoggedInDevice() async throws {
        try await withLoggedInApp { app, _, _, _ in
            let devices = await app.devices()
            #expect(devices.first?.devices.contains { $0.name == "Test Device" && $0.current } == true)
            app.stop()
        }
    }
}
