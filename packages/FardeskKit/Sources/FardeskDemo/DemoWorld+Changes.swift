import FardeskModels
import Foundation

/// How the demo changes a session: rows are added or replaced, the summary is patched, and the app is told the way a real
/// machine's stream would tell it (rows first, then the session).
extension DemoWorld {
    static let replyText = "This is a demo session: nothing leaves this device, and no computer runs Claude here. Pair a machine to work on real sessions."

    func newID(_ prefix: String) -> String {
        state.withLock {
            $0.counter += 1
            return "\(prefix)-\($0.counter)"
        }
    }

    func row(_ kind: String, id: String, _ fields: [String: Any]) throws -> Activity {
        try DemoJSON.decode(from: fields.merging(["kind": kind, "id": id, "ts": DemoJSON.iso(clock())]) { mine, _ in mine })
    }

    /// Applies one change to a session and tells the app. `patch` replaces summary fields; `adding` appends rows;
    /// `replacing` swaps a row of the same id.
    @discardableResult
    func change(
        _ sessionID: String, on key: String, patch: [String: Any] = [:], adding: [Activity] = [], replacing: Activity? = nil
    ) throws -> SessionSummary {
        var changes = patch
        changes["updatedAt"] = DemoJSON.iso(clock())
        let updated: DemoFixture.SessionRecord = try state.withLock { state in
            guard var record = state.sessions[sessionID], record.machine == key else { throw DemoWorld.notFound("session \(sessionID)") }
            record.summary = try DemoJSON.patched(record.summary, changes)
            if let replacing, let index = record.activities.firstIndex(where: { $0.id == replacing.id }) {
                record.activities[index] = replacing
            }
            record.activities.append(contentsOf: adding)
            state.sessions[sessionID] = record
            return record
        }
        emit((adding + [replacing].compactMap { $0 }).map { .activity(sessionId: sessionID, activity: $0) } + [.session(updated.summary)], machineKey: key)
        return updated.summary
    }

    /// Adds a session that did not exist (new, fork, clear) and tells the app.
    func insert(_ record: DemoFixture.SessionRecord) {
        state.withLock { $0.sessions[record.summary.id] = record }
        emit([.session(record.summary)], machineKey: record.machine)
    }

    /// The canned answer a pretend Claude gives a moment after the user wrote or decided something.
    func scheduleReply(sessionID: String, on key: String) {
        let delay = replyDelay
        Task { [self] in
            try? await Task.sleep(for: delay)
            guard let reply = try? row("assistant", id: newID("demo-reply"), ["text": Self.replyText]) else { return }
            let patch: [String: Any] = ["status": "idle", "waitingFor": NSNull(), "summary": Self.replyText, "canStop": false]
            _ = try? change(sessionID, on: key, patch: patch, adding: [reply])
        }
    }

    /// The end of the notification pause (nil = none, or it ended). Demo only: no notification is ever sent.
    func pausedUntil(now: Date) -> Date? {
        state.withLock { $0.pausedUntil.flatMap { $0 > now ? $0 : nil } }
    }

    func pause(minutes: Int, now: Date) -> Date? {
        state.withLock {
            $0.pausedUntil = minutes > 0 ? now.addingTimeInterval(Double(minutes) * 60) : nil
            return $0.pausedUntil
        }
    }

    func working(_ sessionID: String, on key: String, adding rows: [Activity] = [], replacing: Activity? = nil) throws {
        let patch: [String: Any] = ["status": "working", "waitingFor": NSNull(), "canStop": true, "summary": "Working on it"]
        try change(sessionID, on: key, patch: patch, adding: rows, replacing: replacing)
        scheduleReply(sessionID: sessionID, on: key)
    }
}
