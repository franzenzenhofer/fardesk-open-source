import FardeskStore
import Foundation
import Synchronization

/// Finds out when the main thread does not answer. A thread of its own asks the main queue for a heartbeat
/// every 0.5 s; when the answer is late it writes the delay (at 1, 2, 10 and 30 s) and the last breadcrumb to
/// `hangs.jsonl`. The next launch turns those lines into `hang` events for the hub.
private final class Beat: Sendable {
    private let stored = Mutex(Date())
    var value: Date { stored.withLock { $0 } }
    func touch(_ date: Date) { stored.withLock { $0 = date } }
}

final class Watchdog: @unchecked Sendable {
    private static let interval: TimeInterval = 0.5
    /// A pause this long between two rounds means the whole process was suspended, not that the main thread hung.
    private static let suspendedAfter: TimeInterval = 1.5

    private let log: HangLog
    /// Added to every record (UI test runs: XCUITest evaluates its element queries on the app's main thread).
    private let note: String?
    private let lastBeat = Beat()

    init(log: HangLog, note: String? = nil) {
        self.log = log
        self.note = note
    }

    func start() {
        let thread = Thread { [self] in watch() }
        thread.name = "fardesk.watchdog"
        thread.qualityOfService = .utility
        thread.start()
    }

    private func watch() {
        var written = 0.0
        var previousRound = Date()
        while true {
            DispatchQueue.main.async { [lastBeat] in lastBeat.touch(Date()) }
            Thread.sleep(forTimeInterval: Self.interval)
            let now = Date()
            defer { previousRound = now }
            if now.timeIntervalSince(previousRound) > Self.suspendedAfter {
                lastBeat.touch(now)
                written = 0
                continue
            }
            let late = now.timeIntervalSince(lastBeat.value)
            guard late >= HangThresholds.seconds[0] else {
                written = 0
                continue
            }
            guard let crossed = HangThresholds.newlyCrossed(elapsed: late, alreadyWritten: written) else { continue }
            written = crossed
            try? log.append(HangRecord(at: now, seconds: crossed, breadcrumb: Breadcrumbs.current + (note.map { " [\($0)]" } ?? ""))) 
        }
    }
}
