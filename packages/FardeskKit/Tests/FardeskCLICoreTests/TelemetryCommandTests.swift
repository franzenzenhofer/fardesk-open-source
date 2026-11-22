@testable import FardeskCLICore
import FardeskClient
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private let hookShort = shortID(SeedSession.hookSessionID)
private let endedShort = shortID(SeedSession.endedSessionID)

struct ErrorsCommandTests {
    @Test func reportThenListShowsTheReportWithMachineAreaAndVersion() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let empty = await cli.run(["errors"])
            #expect(empty.status == 0 && empty.outText == "No errors reported")
            let sent = await cli.run(["errors", "--report", "wiring probe"])
            #expect(sent.status == 0 && sent.outText == "Reported")
            let listed = await cli.run(["errors"])
            #expect(listed.out.first?.hasPrefix("MACHINE") == true)
            let row = try #require(listed.out.last)
            #expect(row.contains("box") && row.contains("cli") && row.contains("wiring probe") && row.contains("\(FardeskCLI.version) (cli)"))
        }
    }

    @Test func jsonListsContractReportsAndReportJsonIsTheResult() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let sent = await cli.run(["errors", "--report", "json probe", "--json"])
            #expect(sent.outText == #"{"accepted":1,"duplicates":0}"#)
            let listed = await cli.run(["errors", "--json"])
            let reports = try FardeskJSON.makeDecoder().decode([TelemetryReport].self, from: Data(listed.outText.utf8))
            #expect(reports.map(\.message) == ["json probe"])
            #expect(reports[0].area == "cli" && reports[0].platform == "cli" && reports[0].machine == "box")
        }
    }

    @Test func sinceAndLimitFilterAndTwoMachinesAreMergedWithoutDuplicates() async throws {
        try await CLIHarness.withPairedDaemon { cli, first in
            try await TestDaemon.with { second in
                try await cli.pair(second, name: "other")
                let early = TelemetryReport(at: Date(timeIntervalSince1970: 1_800_000_000), message: "shared", area: "a", appVersion: "1", build: "2", platform: "p")
                let late = TelemetryReport(at: Date(timeIntervalSince1970: 1_800_000_100), message: "only on other", area: "b", appVersion: "1", build: "2", platform: "p")
                for (daemon, reports) in [(first, [early]), (second, [early, late])] {
                    let api = daemon.api(token: TestDaemon.token)
                    _ = try await api.reportTelemetry(reports)
                }
                let both = await cli.run(["errors", "--json"])
                let reports = try FardeskJSON.makeDecoder().decode([TelemetryReport].self, from: Data(both.outText.utf8))
                #expect(reports.map(\.message) == ["only on other", "shared"], "newest first, the shared id once")
                let limited = await cli.run(["errors", "--json", "--limit", "1"])
                #expect(limited.outText.contains("only on other") && !limited.outText.contains("shared"))
                let recent = await cli.run(["errors", "--json", "--since", "2027-01-15T08:00:50Z"])
                #expect(recent.outText.contains("only on other") && !recent.outText.contains("shared"))
                let onlyBox = await cli.run(["errors", "--json", "--machine", "box"])
                #expect(onlyBox.outText.contains("shared") && !onlyBox.outText.contains("only on other"))
            }
        }
    }


    @Test func badArgumentsAreUsageErrors() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            #expect(await cli.run(["errors", "--since", "yesterday"]).status == 64)
            #expect(await cli.run(["errors", "--limit", "0"]).status == 64)
            #expect(await cli.run(["errors", "--report", "x", "--limit", "3"]).status == 64)
            #expect(await cli.run(["errors", "--since", "2026-11-15"]).status == 0)
        }
    }

    @Test func reportNeedsOneMachineWhenSeveralArePaired() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            try await TestDaemon.with { second in
                try await cli.pair(second, name: "other")
                let result = await cli.run(["errors", "--report", "x"])
                #expect(result.status == 64 && result.errText.contains("--machine"))
            }
        }
    }

    @Test func sinceAcceptsTimesWithAndWithoutFractionsAndPlainDates() throws {
        #expect(try SinceOption.parse("2026-11-15T09:30:12.500Z").timeIntervalSince1970 == 1_794_735_012.5)
        #expect(try SinceOption.parse("2026-11-15T09:30:12Z").timeIntervalSince1970 == 1_794_735_012)
        #expect(try SinceOption.parse("2026-11-15").timeIntervalSince1970 == 1_794_700_800)
    }
}

struct AttachAndKillCommandTests {
    @Test func replyUploadsEachFileBeforeSendingAndRejectsUnknownTypes() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let png = cli.home.appending(path: "shot.png")
            let wav = cli.home.appending(path: "note.WAV")
            try Data([1, 2, 3]).write(to: png)
            try Data([4, 5]).write(to: wav)
            let result = await cli.run(["reply", endedShort, "see", "this", "--attach", png.path, "--attach", wav.path])
            #expect(result.status == 1 && result.errText.hasPrefix("error: "), "an ended session cannot be reached, but both files were stored first")
            let index = try String(contentsOf: daemon.stateDirectory.appending(path: "attachments-index.json"), encoding: .utf8)
            #expect(index.contains("shot.png") && index.contains("note.WAV"))

            let bad = cli.home.appending(path: "notes.txt")
            try Data([1]).write(to: bad)
            let unsupported = await cli.run(["reply", endedShort, "x", "--attach", bad.path])
            #expect(unsupported.status == 64 && unsupported.errText.contains("unsupported file type"))
            let missing = await cli.run(["reply", endedShort, "x", "--attach", cli.home.appending(path: "gone.png").path])
            #expect(missing.status == 1 && missing.errText.contains("Cannot read"))
        }
    }

    @Test func killWithCloseTabPrintsWhatItClosedAndJsonIsTheResult() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let killed = await cli.run(["kill", hookShort, "--yes", "--close-tab", "--json"])
            #expect(killed.status == 0 && killed.outText == #"{"closed":"none","ok":true}"#, "\(killed.errText)")
        }
    }

    @Test func machinesShowsTheGhosttyColumn() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["machines"])
            #expect(result.out.first?.hasSuffix("GHOSTTY") == true)
            #expect(result.out.last?.hasSuffix("unknown") == true || result.out.last?.hasSuffix("ok") == true || result.out.last?.hasSuffix("denied") == true)
        }
    }
}

struct TelemetryRenderingTests {
    private let options = RenderOptions(now: Date(timeIntervalSince1970: 0), format: .human, timeZone: .gmt)

    @Test func killedPrintsWhatWasClosed() throws {
        #expect(try ActionRenderer.render(.killed(closed: .none), options: options) == "Killed")
        #expect(try ActionRenderer.render(.killed(closed: .pane), options: options) == "Killed\nclosed pane")
        #expect(try ActionRenderer.render(.killed(closed: .tab), options: options) == "Killed\nclosed tab")
    }

    @Test func deniedAutomationGetsAHintUnderTheTable() throws {
        let machine = try Fixtures.machine("macosAutomationDenied")
        var state = MachineState(endpoint: Fixtures.endpoint("Studio Mac"))
        state.apply(.hello(machine: machine, sessions: []))
        let text = try MachinesRenderer.render([state], options: options)
        #expect(text.contains("denied"))
        #expect(text.hasSuffix("Studio Mac: allow Automation for Ghostty in System Settings > Privacy & Security > Automation"))
    }
}
