import FardeskClient
import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

@Suite(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
struct AuthCommandTests {
    @Test(arguments: ["login", "rotate-password"])
    func thePasswordCommandsAreGone(command: String) async throws {
        let cli = try CLIHarness()
        let result = await cli.run([command])
        #expect(result.status == 64, "\(result.errText)")
    }

    @Test func devicesRevokeAndLogoutWorkEndToEnd() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let code = try await PairingLinks.mintCode(url: daemon.url)
            _ = try await daemon.api(token: nil, timeout: 5).pair(code: code, deviceName: "Test Phone")

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
        try await CLIHarness.withPairedDaemon { cli, _ in
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
}
