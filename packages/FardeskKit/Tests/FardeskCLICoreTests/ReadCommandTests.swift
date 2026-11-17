import FardeskClient
import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

struct PairAndMachinesTests {
    @Test func pairStoresTheTokenOnlyInAPrivateTokenFileAndNotInTheMachineList() async throws {
        try await TestDaemon.with { daemon in
            let cli = try CLIHarness()
            let result = try await cli.pair(daemon, name: "Studio")
            #expect(result.outText == "Paired Studio at \(daemon.url.absoluteString)")
            let attributes = try FileManager.default.attributesOfItem(atPath: cli.tokensURL.path)
            #expect((attributes[.posixPermissions] as? Int) == 0o600)
            let machineFile = try String(contentsOf: cli.machinesURL, encoding: .utf8)
            #expect(!machineFile.contains(TestDaemon.token))
            let tokenFile = try String(contentsOf: cli.tokensURL, encoding: .utf8)
            #expect(tokenFile.contains(TestDaemon.token))
        }
    }

    @Test func pairingTheSameMachineAgainKeepsItsId() async throws {
        try await TestDaemon.with { daemon in
            let cli = try CLIHarness()
            try await cli.pair(daemon, name: "Studio")
            let first = try MachineListFile(url: cli.machinesURL).load().endpoints
            try await cli.pair(daemon, name: "Renamed")
            let second = try MachineListFile(url: cli.machinesURL).load().endpoints
            #expect(first.map(\.id) == second.map(\.id) && second.map(\.name) == ["Renamed"])
        }
    }

    @Test func pairRejectsNonLinksWithAnError() async throws {
        let cli = try CLIHarness()
        let result = await cli.run(["pair", "https://example.com"])
        #expect(result.status == 1)
        #expect(result.errText.contains("Not a Fardesk pairing link"))
    }

    @Test func machinesShowsNameStatusSessionsAndVersionInTextAndJson() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let text = await cli.run(["machines"])
            #expect(text.status == 0)
            #expect(text.out.count == 2)
            #expect(text.out[1].hasPrefix("box") && text.out[1].contains("online") && text.out[1].contains("3"))
            let json = await cli.run(["machines", "--json"])
            let machines = try FardeskJSON.makeDecoder().decode([Machine].self, from: Data(json.outText.utf8))
            #expect(machines.map(\.name) == ["test-box"])
        }
    }

    @Test func unreachableMachineIsOfflineWithoutFailingTheOthers() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let dead = MachineEndpoint(name: "dead", url: URL(string: "http://127.0.0.1:9")!)
            var list = try MachineListFile(url: cli.machinesURL).load()
            list.add(dead)
            try MachineListFile(url: cli.machinesURL).save(list)
            try TokenStore.file(url: cli.tokensURL).save("x", dead.id)
            let result = await cli.run(["machines"])
            #expect(result.status == 0)
            #expect(result.out.contains { $0.hasPrefix("box") && $0.contains("online") })
            #expect(result.out.contains { $0.hasPrefix("dead") && $0.contains("offline") })
            let sessions = await cli.run(["sessions"])
            #expect(sessions.status == 0 && sessions.out.contains { $0.hasPrefix("dead  Offline") })
        }
    }

    @Test func noMachinesIsSaidPlainly() async throws {
        let cli = try CLIHarness()
        #expect(await cli.run(["machines"]).outText == "No machines paired")
        #expect(await cli.run(["sessions"]).outText == "No machines paired")
    }
}

struct SessionAndActivityTests {
    @Test func sessionsAreGroupedPerMachineWithWorkingBeforeEnded() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["sessions"])
            #expect(result.status == 0)
            #expect(result.out.first == "box  Online")
            let ids = [SeedSession.hookSessionID, SeedSession.endedSessionID, SeedSession.editsSessionID].map(shortID)
            let positions = ids.map { id in result.out.firstIndex { $0.contains(id) } }
            #expect(positions.allSatisfy { $0 != nil })
            #expect(positions[0]! < positions[1]! && positions[0]! < positions[2]!)
        }
    }

    @Test func sessionsJsonIsOneEnvelopePerSessionInTheContractShape() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let result = await cli.run(["sessions", "--json"])
            let rows = try #require(JSONSerialization.jsonObject(with: Data(result.outText.utf8)) as? [[String: Any]])
            #expect(rows.count == 3 && rows.allSatisfy { $0["machine"] as? String == "box" })
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let sessions = try await api.sessions()
            let sent = Set(rows.compactMap { ($0["session"] as? [String: Any])?["id"] as? String })
            #expect(sent == Set(sessions.map(\.id)))
        }
    }

    @Test func activityPrintsTheRowsTheDaemonSendsThroughTheRenderer() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let session = SeedSession.editsSessionID
            let result = await cli.run(["activity", shortID(session)])
            #expect(result.status == 0)
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let page = try await api.activity(sessionID: session)
            let expected = try FeedRenderer.render(
                page.items,
                options: RenderOptions(now: Date(), format: .human, timeZone: TimeZone(identifier: "UTC") ?? .current)
            )
            #expect(result.outText == expected)
            let json = await cli.run(["activity", shortID(session), "--json", "--limit", "2"])
            #expect(json.out.count == 2)
            #expect(try json.out.allSatisfy { try JSONSerialization.jsonObject(with: Data($0.utf8)) is [String: Any] })
        }
    }

    @Test func activityPagesBackWithBeforeAndAll() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let session = SeedSession.editsSessionID
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let everything = try await api.activity(sessionID: session, limit: 200).items
            #expect(everything.count > 2)
            let newest = try await api.activity(sessionID: session, limit: 1)
            let cursor = try #require(newest.nextBefore)
            let older = try await api.activity(sessionID: session, before: cursor, limit: 1)

            let before = await cli.run(["activity", shortID(session), "--json", "--before", cursor, "--limit", "1"])
            #expect(before.status == 0 && before.out.count == 1)
            let expectedID = try #require(older.items.first?.id)
            #expect(before.outText.contains(expectedID))

            let paged = await cli.run(["activity", shortID(session), "--json", "--all", "--limit", "1"])
            let whole = await cli.run(["activity", shortID(session), "--json", "--limit", "200"])
            #expect(paged.status == 0)
            #expect(paged.out.count == everything.count)
            #expect(paged.out == whole.out)

            let rejected = await cli.run(["activity", shortID(session), "--follow", "--all"])
            #expect(rejected.status != 0)
        }
    }

    @Test func detailPrintsTheDiffOrOutputBehindARow() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let session = SeedSession.editsSessionID
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let rows = try await api.activity(sessionID: session, limit: 200).items
            let id = try #require(rows.compactMap { item -> String? in
                if case .tool(let tool) = item, tool.hasDetail { tool.id } else { nil }
            }.first)
            let result = await cli.run(["detail", shortID(session), id])
            #expect(result.status == 0 && !result.outText.isEmpty)
            let json = await cli.run(["detail", shortID(session), id, "--json"])
            #expect(try FardeskJSON.makeDecoder().decode(ActivityDetail.self, from: Data(json.outText.utf8)).activityId == id)
            let missing = await cli.run(["detail", shortID(session), "no-such-row"])
            #expect(missing.status == 1 && missing.errText.contains("(not_found)"))
        }
    }

    @Test func foldersListsTheRecentFolders() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let result = await cli.run(["folders", "--machine", "bo"])
            #expect(result.status == 0)
            let api = FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5)
            let count = try await api.recentFolders().folders.count
            #expect(result.out.count == max(count, 1))
            let json = await cli.run(["folders", "--json"])
            #expect(try FardeskJSON.makeDecoder().decode(RecentFolders.self, from: Data(json.outText.utf8)).folders.count == count)
        }
    }

    @Test func unknownSessionsAndMachinesAreUsageErrors() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let unknown = await cli.run(["activity", "zzzzzzzz"])
            #expect(unknown.status == 64 && unknown.errText == "error: No session matches \"zzzzzzzz\"")
            let json = await cli.run(["activity", "zzzzzzzz", "--json"])
            #expect(json.errText.hasPrefix("{\"error\":{\"code\":\"invalid_request\""))
            let noMachine = await cli.run(["sessions", "--machine", "nope"])
            #expect(noMachine.status == 64 && noMachine.errText.contains("No machine named"))
        }
    }

    @Test func usageErrorsExitWithCodeTwoAndHelpWithZero() async throws {
        let cli = try CLIHarness()
        #expect(await cli.run(["bogus"]).status == 64)
        #expect(await cli.run(["new", "--cwd", "/x"]).status == 64)
        #expect(await cli.run(["revoke"]).status == 64)
        #expect(await cli.run(["revoke", "phone", "--all"]).status == 64)
        #expect(await cli.run(["revoke", "--all", "--machine", "a", "--all-machines"]).status == 64)
        let help = await cli.run(["--help"])
        #expect(help.status == 0 && help.outText.contains("SUBCOMMANDS"))
        #expect(await cli.run(["reply", "abc"]).status == 64)
    }
}

struct FollowTests {
    @Test func activityFollowPrintsARowAppendedToTheTranscript() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let follower = try cli.sibling()
            let running = Task { await follower.run(["activity", shortID(SeedSession.hookSessionID), "--follow", "--limit", "1"]) }
            try await Task.sleep(for: .seconds(1))
            try daemon.appendUserPrompt("a row written while following", toSession: SeedSession.hookSessionID)
            let seen = try await waitUntil { follower.output.out.contains { $0.contains("a row written while following") } }
            running.cancel()
            let finished = await running.value
            #expect(seen)
            #expect(finished.status == 0)
        }
    }

    @Test func sessionsWatchPrintsTheListAgainWhenASessionChanges() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let watcher = try cli.sibling()
            let running = Task { await watcher.run(["sessions", "--watch"]) }
            let first = try await waitUntil { watcher.output.out.filter { $0 == "box  Online" }.count >= 2 }
            running.cancel()
            _ = await running.value
            #expect(first, "the list is printed once, and again when the stream's hello arrives")
            _ = daemon
        }
    }
}
