import FardeskCLICore
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

private let hookShort = shortID(SeedSession.hookSessionID)

/// The `[pending <request id>]` markers in `fardesk activity` output.
private func pendingIDs(_ result: CLIResult) -> [String] {
    result.out.compactMap { line in
        guard let start = line.range(of: "[pending "), let end = line[start.upperBound...].firstIndex(of: "]") else { return nil }
        return String(line[start.upperBound..<end])
    }
}

private func waitForPending(_ cli: CLIHarness, count: Int) async throws -> [String] {
    let result = try await cli.wait(["activity", hookShort]) { pendingIDs($0).count >= count }
    return pendingIDs(result)
}

struct PermissionFlowTests {
    @Test func approveAllowsARealPendingRequestAndTheHookReceivesTheDecision() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let hook = try daemon.fireHook(fixture: "PermissionRequest-bash")
            #expect(try await waitForPending(cli, count: 1).count == 1)
            let waiting = await cli.run(["sessions"])
            #expect(waiting.out.contains { $0.contains(hookShort) && $0.contains("!") })
            let approved = await cli.run(["approve", hookShort])
            #expect(approved.status == 0 && approved.outText == "Allowed")
            let reply = await hook.result()
            #expect(reply.output.contains("allow") && !reply.output.contains("deny"))
            #expect(try await waitForPending(cli, count: 0).isEmpty)
        }
    }

    @Test func denyAndAlwaysAndExplicitRequestIdsWork() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let denied = try daemon.fireHook(fixture: "PermissionRequest-bash")
            _ = try await waitForPending(cli, count: 1)
            let deny = await cli.run(["deny", hookShort])
            #expect(deny.status == 0 && deny.outText == "Denied")
            #expect(await denied.result().output.contains("deny"))

            let always = try daemon.fireHook(fixture: "PermissionRequest-bash")
            let ids = try await waitForPending(cli, count: 1)
            let approve = await cli.run(["approve", hookShort, ids[0], "--always"])
            #expect(approve.status == 0 && approve.outText.hasPrefix("Allowed, and always"))
            #expect(await always.result().status == 0)
        }
    }

    @Test func severalPendingRequestsNeedAnIdAndAWrongIdIsRejected() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let first = try daemon.fireHook(fixture: "PermissionRequest-bash")
            let second = try daemon.fireHook(fixture: "PermissionRequest-bash")
            let ids = try await waitForPending(cli, count: 2)
            let ambiguous = await cli.run(["approve", hookShort])
            #expect(ambiguous.status == 1 && ambiguous.errText.contains("Several requests are waiting"))
            let wrong = await cli.run(["deny", hookShort, "nope"])
            #expect(wrong.status == 1 && wrong.errText.contains("No pending request nope"))
            for id in ids { #expect(await cli.run(["deny", hookShort, id]).status == 0) }
            _ = await (first.result(), second.result())
        }
    }

    @Test func nothingWaitingIsAnError() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["approve", hookShort])
            #expect(result.status == 1 && result.errText.contains("Nothing is waiting"))
            #expect(await cli.run(["answer", hookShort, "yes"]).status == 1)
        }
    }

    @Test func answerPicksAnOptionOfAPendingQuestion() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            let hook = try daemon.fireHook(fixture: "PermissionRequest-askuserquestion")
            let rows = try await cli.wait(["activity", hookShort, "--json"]) { $0.outText.contains("\"kind\":\"question\"") }
            let objects = rows.out.map { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            let question = try #require(objects.compactMap { $0 }.first { $0["kind"] as? String == "question" })
            let options = question["options"] as? [String]
            let option = try #require(options?.first)
            let answered = await cli.run(["answer", hookShort, option])
            #expect(answered.status == 0 && answered.outText == "Answered: \(option)")
            #expect(await hook.result().output.contains(option))
        }
    }
}

struct ActionCommandTests {
    @Test func killAsksFirstAndCancelsOnNo() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let declined = await cli.run(["kill", hookShort], lines: ["n"])
            #expect(declined.status == 1 && declined.errText.contains("Kill session"))
            #expect(declined.errText.contains("Cancelled"))
            let empty = await cli.run(["kill", hookShort])
            #expect(empty.status == 1)
        }
    }

    @Test func killWithYesEndsTheSessionsProcess() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let killed = await cli.run(["kill", hookShort, "--yes"])
            #expect(killed.status == 0 && killed.outText == "Killed")
            let ended = try await cli.wait(["sessions"]) { result in
                result.out.contains { $0.contains(hookShort) && $0.hasPrefix("  x") }
            }
            #expect(ended.out.contains { $0.contains(hookShort) && $0.hasPrefix("  x") })
        }
    }

    @Test func newWithAMissingFolderReturnsTheDaemonsInvalidRequest() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["new", "--cwd", "/no/such/folder/here", "--prompt", "hello", "--model", "sonnet"])
            #expect(result.status == 1)
            #expect(result.errText.contains("(invalid_request)"))
            let named = await cli.run(["new", "--machine", "bo", "--cwd", "/no/such", "--prompt", "x", "--worktree", "--json"])
            #expect(named.status == 1 && named.errText.contains("\"code\":\"invalid_request\""))
        }
    }

    @Test func replyToASessionTheDaemonCannotReachIsAnError() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["reply", shortID(SeedSession.endedSessionID), "hello", "there"])
            #expect(result.status == 1)
            #expect(result.errText.hasPrefix("error: "))
        }
    }

    @Test func machinesWithoutAMachineFlagNeedOneWhenSeveralArePaired() async throws {
        try await CLIHarness.withPairedDaemon { cli, daemon in
            try await cli.pair(daemon, name: "other")
            let list = try MachineListFile(url: cli.machinesURL).load()
            #expect(list.endpoints.count == 1)
            var extra = list
            extra.add(MachineEndpoint(name: "second", url: URL(string: "http://127.0.0.1:9")!))
            try MachineListFile(url: cli.machinesURL).save(extra)
            let result = await cli.run(["new", "--cwd", "/x", "--prompt", "y"])
            #expect(result.status == 64 && result.errText.contains("Pick the machine with --machine"))
        }
    }

    @Test func everySubcommandParsesItsArguments() throws {
        let lines: [[String]] = [
            ["resume", "abc"], ["takeover", "abc", "--machine", "m"], ["fork", "abc", "--json"],
            ["new", "--cwd", "/x", "--prompt", "p", "--worktree", "--model", "opus"],
            ["approve", "abc", "rid", "--always", "--yes"], ["deny", "abc"], ["answer", "abc", "opt", "rid"],
            ["stop", "abc"], ["kill", "abc", "--yes"], ["reply", "abc", "a", "b", "c"],
            ["activity", "abc", "--follow", "--limit", "5"], ["detail", "abc", "aid"], ["sessions", "--watch"],
            ["pair", "fardesk://pair?d=x"], ["revoke", "--all", "--all-machines"],
            ["revoke", "phone", "--machine", "m"], ["devices", "--machine", "m"], ["logout"],
        ]
        for line in [["compact", "abc"], ["reply", "abc", "hi"]] { _ = try FardeskCommand.parseAsRoot(line) }
        for line in lines { _ = try FardeskCommand.parseAsRoot(line) }
    }
}
