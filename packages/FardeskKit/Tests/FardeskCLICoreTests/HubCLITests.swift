import FardeskClient
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// `fardesk` in hub mode against a REAL hub daemon: what the CLI prints is what the app shows.
struct HubCLITests {
    private static let password = "hub-password"

    /// Sets the hub, logs in once, and runs `body` with a CLI that works through the hub.
    private func withHubCLI(_ body: (CLIHarness, HubRig) async throws -> Void) async throws {
        try await HubRig.with { rig in
            try await rig.hub.setPassword(Self.password)
            let cli = try CLIHarness()
            let set = await cli.run(["hub", "--set", rig.hub.url.absoluteString])
            #expect(set.status == 0, "\(set.errText)")
            let login = await cli.run(["login"], secrets: [Self.password])
            #expect(login.status == 0, "\(login.errText)")
            try await body(cli, rig)
        }
    }

    @Test func hubSetWritesTheKeyAndClearRemovesIt() async throws {
        let cli = try CLIHarness()
        let none = await cli.run(["hub"])
        #expect(none.outText.contains("No hub"))
        let set = await cli.run(["hub", "--set", "http://100.64.0.10:4780"])
        #expect(set.status == 0 && set.outText.contains("http://100.64.0.10:4780"))
        let file = String(decoding: try Data(contentsOf: cli.machinesURL), as: UTF8.self)
        #expect(file.contains("\"hub\""))
        #expect(await cli.run(["hub", "--set", "ftp://nope"]).status == 64)
        #expect(await cli.run(["hub", "--clear"]).outText.contains("No hub"))
        #expect(try MachineListFile(url: cli.machinesURL).load().hub == nil)
    }

    @Test(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
    func machinesPrintsTheHubTableWithTheAppsWording() async throws {
        try await withHubCLI { cli, rig in
            let table = await cli.run(["machines"])
            #expect(table.status == 0, "\(table.errText)")
            #expect(table.out.first?.hasPrefix("NAME") == true)
            let hubRow = try #require(table.out.first { $0.hasPrefix(HubRig.hubName) })
            let peerRow = try #require(table.out.first { $0.hasPrefix(HubRig.peerName) })
            let deadRow = try #require(table.out.first { $0.hasPrefix(HubRig.deadName) })
            #expect(hubRow.contains("Online") && peerRow.contains("Online"))
            #expect(deadRow.contains("Offline"))

            let json = await cli.run(["machines", "--json"])
            let state = try FardeskJSON.makeDecoder().decode(HubState.self, from: Data(json.outText.utf8))
            let dead = try #require(state.machines.first { $0.name == HubRig.deadName })
            let words = MachinePresentation(hub: dead, now: Date())
            #expect(deadRow.contains(try #require(words.problem)), "the CLI row carries the same problem text the app shows")
            #expect(words.statusLabel == "Offline")
            #expect(state.machines.first { $0.name == HubRig.peerName }?.sessions == SeedSession.standard.count)
            _ = rig
        }
    }

    @Test(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
    func sessionsAndActionsGoThroughTheHubAndAnOfflineMachineIsQuiet() async throws {
        try await withHubCLI { cli, _ in
            let sessions = await cli.run(["sessions"])
            #expect(sessions.status == 0, "\(sessions.errText)")
            #expect(sessions.outText.contains(shortID(SeedSession.editsSessionID)))
            #expect(sessions.errText.isEmpty, "an offline machine is a row, not an error")

            let clear = await cli.run(["clear", shortID(SeedSession.endedSessionID)])
            #expect(clear.status == 1 && clear.errText.contains("conflict"), "the clear route answered: \(clear.errText)")
            let viaReply = await cli.run(["reply", shortID(SeedSession.endedSessionID), "/clear"])
            #expect(viaReply.status == 1 && viaReply.errText == clear.errText, "reply /clear is the clear route")

            let badMode = await cli.run(["new", "--machine", "Peer", "--cwd", "/x", "--prompt", "p", "--mode", "nonsense"])
            #expect(badMode.status == 64)
            let missingFolder = await cli.run(["new", "--machine", "Peer", "--cwd", "/no/such/dir", "--prompt", "p", "--mode", "plan"])
            #expect(missingFolder.status == 1 && missingFolder.errText.contains("invalid_request"))
            let offline = await cli.run(["new", "--machine", "Dead", "--cwd", "/x", "--prompt", "p"])
            #expect(offline.status == 1 && offline.errText.contains("machine_offline"))
        }
    }

    @Test(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
    func pauseReachesEveryMachineAndEventsShowWhatTheCLIDid() async throws {
        try await withHubCLI { cli, _ in
            let paused = await cli.run(["pause", "30"])
            #expect(paused.status == 0, "\(paused.errText)")
            #expect(paused.out.contains { $0.hasPrefix("\(HubRig.peerName): paused until") })
            #expect(paused.out.contains { $0.hasPrefix("\(HubRig.deadName):") && !$0.contains("paused until") })
            let resumed = await cli.run(["pause", "off"])
            #expect(resumed.out.contains("\(HubRig.peerName): notifications on"))
            #expect(await cli.run(["pause", "abc"]).status == 64)

            _ = await cli.run(["machines"])
            let events = try await cli.wait(["events", "--since", "1h"]) { $0.outText.contains("fardesk machines -> exit 0") }
            #expect(events.status == 0, "\(events.errText)")
            #expect(events.outText.contains("cli.command"))
            #expect(events.out.first?.hasPrefix("TIME") == true)
            let json = await cli.run(["events", "--json"])
            let reports = try FardeskJSON.makeDecoder().decode([TelemetryReport].self, from: Data(json.outText.utf8))
            #expect(reports.contains { $0.kind == .event && $0.area == "cli.command" && $0.durationMs != nil })
            #expect(reports.allSatisfy { !$0.message.contains(Self.password) })
            #expect(await cli.run(["errors"]).outText.contains("No errors reported"))
        }
    }

    @Test(.enabled(if: DaemonCapabilities.hasAuth, DaemonCapabilities.authSkipReason))
    func followPrintsEventsThatArriveWhileItRuns() async throws {
        try await withHubCLI { cli, _ in
            let other = try cli.sibling()
            async let followed = cli.run(["events", "--follow", "--timeout", "5", "--since", "1m"])
            try await Task.sleep(for: .milliseconds(800))
            _ = await other.run(["sessions"])
            let result = await followed
            #expect(result.status == 0, "\(result.errText)")
            #expect(result.outText.contains("fardesk sessions -> exit 0"))
        }
    }

    @Test func pauseWorksWithoutAHubToo() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let paused = await cli.run(["pause"])
            #expect(paused.status == 0 && paused.outText.contains("box: paused until"), "\(paused.outText)")
            #expect(await cli.run(["pause", "off"]).outText.contains("box: notifications on"))
            #expect(await cli.run(["pause", "99999"]).status == 64)
        }
    }
}
