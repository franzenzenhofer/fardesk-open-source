import FardeskClient
import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private func freshPassword() -> String { "pw-" + UUID().uuidString.lowercased() }

/// An unpaired harness for a daemon with a password, with the machine in the list but no token yet.
private func withPasswordDaemon(
    configOverrides: [String: any Sendable] = [:],
    _ body: (CLIHarness, TestDaemon, String) async throws -> Void
) async throws {
    let password = freshPassword()
    try await TestDaemon.with(configOverrides: configOverrides, password: password) { daemon in
        let cli = try CLIHarness()
        try MachineListFile(url: cli.machinesURL).save(
            MachineList(endpoints: [MachineEndpoint(name: "box", url: daemon.url)])
        )
        try await body(cli, daemon, password)
    }
}

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AuthCommandTests {
    @Test func loginReadsThePasswordAndStoresATokenInThePrivateFile() async throws {
        try await withPasswordDaemon { cli, _, password in
            let result = await cli.run(["login"], secrets: [password])
            #expect(result.status == 0 && result.out.last?.contains("logged in") == true)
            let attributes = try FileManager.default.attributesOfItem(atPath: cli.tokensURL.path)
            #expect((attributes[.posixPermissions] as? Int) == 0o600)
            let text = try String(contentsOf: cli.tokensURL, encoding: .utf8)
            #expect(!text.contains(password))
            let machines = await cli.run(["machines"])
            #expect(machines.out.contains { $0.hasPrefix("box") && $0.contains("online") })
        }
    }

    @Test func wrongPasswordFailsWithExitOneAndStoresNothing() async throws {
        try await withPasswordDaemon { cli, _, _ in
            let result = await cli.run(["login", "--json"], secrets: ["definitely-wrong"])
            #expect(result.status == 1)
            #expect(result.outText.contains("\"status\":\"wrong_password\""))
            #expect(result.errText.contains("Wrong password."))
            #expect(!FileManager.default.fileExists(atPath: cli.tokensURL.path))
        }
    }

    @Test func tooManyAttemptsReportRateLimited() async throws {
        let auth = ["passwordHash": NSNull(), "maxFailures": 2, "windowSeconds": 300] as [String: any Sendable]
        try await withPasswordDaemon(configOverrides: ["auth": auth]) { cli, _, _ in
            var last = await cli.run(["login"], secrets: ["nope"])
            for _ in 0..<4 { last = await cli.run(["login"], secrets: ["nope"]) }
            #expect(last.status == 1 && last.outText.contains("too many attempts"))
        }
    }

    @Test func loginWithAMachineUrlAddsTheMachineAndEmptyPasswordIsUsage() async throws {
        try await TestDaemon.with(password: "unused-for-this-test") { daemon in
            let cli = try CLIHarness()
            let noMachines = await cli.run(["login"], secrets: ["x"])
            #expect(noMachines.status == 64 && noMachines.errText.contains("No machines paired"))
            let badURL = await cli.run(["login", "--machine-url", "nonsense"], secrets: ["x"])
            #expect(badURL.status == 64)
            let empty = await cli.run(["login", "--machine-url", daemon.url.absoluteString], secrets: [""])
            #expect(empty.status == 64 && empty.errText.contains("empty"))
        }
    }

    @Test func loginWithMachineUrlStoresTheNamedMachineWhenThePasswordIsRight() async throws {
        let password = freshPassword()
        try await TestDaemon.with(password: password) { daemon in
            let cli = try CLIHarness()
            let result = await cli.run(["login", "--machine-url", daemon.url.absoluteString, "--name", "Studio"], secrets: [password])
            #expect(result.status == 0)
            let list = try MachineListFile(url: cli.machinesURL).load()
            #expect(list.endpoints.map(\.name) == ["Studio"])
        }
    }

    @Test func devicesRevokeAndLogoutWorkEndToEnd() async throws {
        try await withPasswordDaemon { cli, daemon, password in
            _ = await cli.run(["login"], secrets: [password])
            let phone = FardeskAPI(baseURL: daemon.url, token: nil, timeout: 5)
            _ = try await phone.login(password: password, deviceName: "Test Phone")

            let devices = await cli.run(["devices"])
            #expect(devices.status == 0 && devices.outText.contains("Test Phone") && devices.outText.contains("(this device)"))
            let json = await cli.run(["devices", "--json", "--machine", "box"])
            let rows = try #require(JSONSerialization.jsonObject(with: Data(json.outText.utf8)) as? [[String: Any]])
            #expect(rows.count == 2)

            let revoked = await cli.run(["revoke", "Test Phone"])
            #expect(revoked.status == 0 && revoked.outText == "box: revoked 1 device")
            let afterwards = await cli.run(["devices"])
            #expect(afterwards.outText.contains("revoked"))

            let out = await cli.run(["logout"])
            #expect(out.status == 0 && out.outText == "box: logged out")
            let tokens = TokenStore.file(url: cli.tokensURL)
            let any = try tokens.hasAnyToken()
            #expect(!any)
        }
    }

    @Test func revokeAllAcrossMachinesEndsThisCliToken() async throws {
        try await withPasswordDaemon { cli, _, password in
            _ = await cli.run(["login"], secrets: [password])
            let result = await cli.run(["revoke", "--all", "--all-machines", "--json"])
            #expect(result.status == 0 && result.outText.contains("\"revoked\":1"))
            let next = await cli.run(["devices"])
            #expect(next.status == 0)
            #expect(next.errText.contains("(token_revoked)"))
            let tokens = TokenStore.file(url: cli.tokensURL)
            let any = try tokens.hasAnyToken()
            #expect(!any)
        }
    }

    @Test func rotatePasswordChangesItEverywhereAndLogsTheCliInAgain() async throws {
        try await withPasswordDaemon { cli, _, password in
            _ = await cli.run(["login"], secrets: [password])
            let next = freshPassword()
            let mismatch = await cli.run(["rotate-password"], secrets: [password, next, "different"])
            #expect(mismatch.status == 64)
            let rotated = await cli.run(["rotate-password"], secrets: [password, next, next])
            #expect(rotated.status == 0 && rotated.outText == "box: password changed")
            let machines = await cli.run(["machines"])
            #expect(machines.out.contains { $0.hasPrefix("box") && $0.contains("online") })
            let old = await cli.run(["login"], secrets: [password])
            #expect(old.status == 1)
            let wrongCurrent = await cli.run(["rotate-password"], secrets: ["wrong-current", next, next])
            #expect(wrongCurrent.status == 1 && wrongCurrent.outText.contains("problem"))
        }
    }
}
