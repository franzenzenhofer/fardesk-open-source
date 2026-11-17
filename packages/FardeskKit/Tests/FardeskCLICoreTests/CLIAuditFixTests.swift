import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// The CLI findings of the 2026-11-16 audit (F6, F7, F8).
struct CLIAuditFixTests {
    /// A CLI logged in to a REAL hub (hub set, one login), for the tests that need hub mode.
    private func withHubCLI(_ body: (CLIHarness, HubRig) async throws -> Void) async throws {
        try await HubRig.with { rig in
            try await rig.hub.setPassword("hub-password")
            let cli = try CLIHarness()
            _ = await cli.run(["hub", "--set", rig.hub.url.absoluteString])
            _ = await cli.run(["login"], secrets: ["hub-password"])
            try await body(cli, rig)
        }
    }

    @Test func userMistakesAreUsageErrorsWithAPlainSentence() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let session = await cli.run(["stop", "nosuchsession"])
            #expect(session.status == 64 && session.errText == "error: No session matches \"nosuchsession\"")
            let machine = await cli.run(["sessions", "--machine", "nosuchmachine"])
            #expect(machine.status == 64 && machine.errText.hasPrefix("error: No machine named \"nosuchmachine\""))
            #expect(!machine.errText.contains("(internal)"))
            let missing = await cli.run(["reply", "abc"])
            #expect(missing.status == 64, "a missing message is a usage error: \(missing.errText)")
            let json = await cli.run(["stop", "nosuchsession", "--json"])
            #expect(json.status == 64 && json.errText.contains("\"code\":\"invalid_request\""))
        }
    }

    @Test func replyToAColdSessionStopsWithTheWarningUntilToldHowToGoOn() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let session = shortID(SeedSession.endedSessionID)
            let stopped = await cli.run(["reply", session, "hello"])
            #expect(stopped.status == 64, "\(stopped.errText)")
            #expect(stopped.errText.contains("Resume this conversation? Inactive for ") && stopped.errText.contains("--resume full"))
            let went = await cli.run(["reply", session, "hello", "--resume", "full"])
            #expect(went.status != 64, "--resume full goes on to the daemon: \(went.errText)")
        }
    }

    @Test func aDeclinedConfirmationIsAFailureInWordsNotInternal() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let declined = await cli.run(["kill", shortID(SeedSession.endedSessionID)], lines: ["n"])
            #expect(declined.status == 1 && declined.err.last == "error: Cancelled", "\(declined.errText)")
        }
    }

    @Test func hubJSONPrintsTheHubStateAndNoHubIsAUsageError() async throws {
        let plain = try CLIHarness()
        let none = await plain.run(["hub", "--json"])
        #expect(none.status == 64 && none.errText.contains("No hub is set"))
        let set = await plain.run(["hub", "--set", "http://100.64.0.10:4780", "--json"])
        #expect(set.outText == #"{"hub":"http://100.64.0.10:4780"}"#)

        try await withHubCLI { cli, _ in
            let result = await cli.run(["hub", "--json"])
            let state = try FardeskJSON.makeDecoder().decode(HubState.self, from: Data(result.outText.utf8))
            #expect(result.status == 0 && state.hub == HubRig.hubName)
            #expect(state.machines.map(\.name) == [HubRig.hubName, HubRig.peerName, HubRig.deadName])
            #expect(await cli.run(["hub"]).outText.hasPrefix("Hub: "), "the human view stays text")
        }
    }

    @Test func reportingAnErrorInHubModeNeedsNoMachine() async throws {
        try await withHubCLI { cli, _ in
            let reported = await cli.run(["errors", "--report", "audit probe"])
            #expect(reported.status == 0 && reported.outText == "Reported", "\(reported.errText)")
            let listed = try await cli.wait(["errors"]) { $0.outText.contains("audit probe") }
            #expect(listed.outText.contains("audit probe"), "the hub holds it")
        }
    }

    @Test func reportingWithSeveralMachinesAndNoFlagStillAsksWhichOne() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            try await TestDaemon.with { second in
                _ = await cli.run(["pair", try CLIHarness.pairingLink(second, name: "other")])
                let result = await cli.run(["errors", "--report", "x"])
                #expect(result.status == 64 && result.errText.contains("--machine"), "\(result.errText)")
            }
        }
    }

    @Test func eventsHideTheHelpRunsOfTheCLIUnlessAll() async throws {
        try await withHubCLI { cli, _ in
            _ = await cli.run(["--help"])
            _ = await cli.run(["machines", "--help"])
            _ = await cli.run(["machines"])
            let everything = try await cli.wait(["events", "--all"]) { $0.outText.contains("fardesk machines -> exit 0") && $0.outText.contains("--help") }
            #expect(everything.outText.contains("--help"), "--all keeps the help rows:\n\(everything.outText)")
            let tidy = await cli.run(["events"])
            #expect(tidy.outText.contains("fardesk machines -> exit 0"))
            #expect(!tidy.outText.contains("--help") && !tidy.outText.contains("fardesk help"), "default view:\n\(tidy.outText)")
        }
    }
}
