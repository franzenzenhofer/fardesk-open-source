import Foundation

extension TestDaemon {
    private static let hookURL = "http://fardesk/hook"
    private static let hookMaxSeconds = "30"

    /// Posts a real hook payload fixture through the daemon's hook socket, exactly like Claude
    /// Code's hook command (curl over the Unix socket). A permission hook stays open until the
    /// request is decided, so this returns the running process; `result()` is the daemon's answer.
    public func fireHook(fixture: String) throws -> RunningProcess {
        let payload = RepoPaths.fixtures.appending(path: "hooks/\(fixture).json").path
        return try RunningProcess(
            executable: "/usr/bin/curl",
            arguments: [
                "-s", "-m", Self.hookMaxSeconds, "--unix-socket", hookSocket.path,
                "-H", "Content-Type: application/json", "--data-binary", "@\(payload)", Self.hookURL,
            ]
        )
    }
}
