import Foundation

/// A machine-wide cap on how many test daemons run at once, across every `swift test` process of this user.
///
/// Without it, Swift Testing runs every test in parallel and each test starts its own real fardeskd (a node process
/// plus seeded helper processes): one `swift test` put ~120 daemons up at once, and a few agents testing side by side
/// drove the load average past 250. A slot is an exclusive `flock` on one of `limit` files; the kernel drops the lock
/// when the process ends, so a crashed run never leaks a slot. The fd is close-on-exec, so the daemon never holds it.
///
/// The cap is soft: a test that waited `maxWait` without a slot runs anyway, so a test needing several daemons at once
/// can never deadlock against others. Override the size with FARDESK_TEST_MAX_DAEMONS.
final class DaemonSlot: @unchecked Sendable {
    private var fd: Int32

    private init(fd: Int32) { self.fd = fd }

    deinit { release() }

    func release() {
        guard fd >= 0 else { return }
        flock(fd, LOCK_UN)
        close(fd)
        fd = -1
    }

    static var limit: Int {
        if let raw = ProcessInfo.processInfo.environment["FARDESK_TEST_MAX_DAEMONS"], let value = Int(raw), value > 0 {
            return value
        }
        return max(4, ProcessInfo.processInfo.activeProcessorCount)
    }

    /// A fixed path, not TMPDIR: agent sandboxes give each session its own TMPDIR, and the cap must be shared.
    static let directory = URL(fileURLWithPath: "/tmp/fardesk-test-daemon-slots-\(getuid())", isDirectory: true)

    /// A free slot, or nil after `maxWait` (the caller then runs without one rather than wait forever).
    static func acquire(maxWait: Duration = .seconds(90)) async -> DaemonSlot? {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let clock = ContinuousClock()
        let deadline = clock.now + maxWait
        let count = limit
        while true {
            for index in (0..<count).shuffled() {
                let path = directory.appending(path: "slot-\(index).lock").path
                let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
                guard fd >= 0 else { continue }
                if flock(fd, LOCK_EX | LOCK_NB) == 0 { return DaemonSlot(fd: fd) }
                close(fd)
            }
            if clock.now >= deadline || Task.isCancelled { return nil }
            try? await Task.sleep(for: .milliseconds(Int.random(in: 50..<150)))
        }
    }
}
