import Foundation
import FardeskTestDaemon
import Testing

/// The Swift test daemon must run inside the daemon's test sandbox. Without it, `kill --close-tab` on a seeded session
/// walked the seeded process's ancestors (test runner, shell, agent) up to the tmux pane the test runner itself ran in
/// and closed that pane, which ended the person's tmux server (2026-11-18, during scripts/open-source/export.sh).
struct TestSandboxTests {
    @Test func theTestDaemonRunsInsideItsOwnSandbox() async throws {
        try await TestDaemon.with(sessions: []) { daemon in
            #expect(daemon.daemonEnvironment["FARDESK_TEST_SANDBOX"] == daemon.root.path)
            let pid = try #require(daemonPid(port: daemon.port))
            let environment = try await RunningProcess.run("ps", ["eww", "-o", "command=", "-p", String(pid)]).output
            #expect(environment.contains("FARDESK_TEST_SANDBOX=\(daemon.root.path)"))
        }
    }
}

private func daemonPid(port: Int) -> Int32? {
    let lsof = Process()
    let pipe = Pipe()
    lsof.executableURL = URL(filePath: "/usr/sbin/lsof")
    lsof.arguments = ["-nP", "-t", "-iTCP:\(port)", "-sTCP:LISTEN"]
    lsof.standardOutput = pipe
    guard (try? lsof.run()) != nil else { return nil }
    lsof.waitUntilExit()
    let text = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    return text.split(separator: "\n").first.flatMap { Int32($0) }
}
