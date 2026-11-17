import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// `fardesk activity --follow`: new and changed rows of one session, until cancelled.
/// With `endsWithTurn` it returns when the turn really ended (see `FollowStop`).
struct ActivityFollower {
    private enum Step: Sendable {
        case update(StreamUpdate)
        case failed(any Error)
        case tick
    }

    /// What the stop decision needs to remember between events.
    private struct Progress {
        var status: SessionStatus = .working
        var nonWorkingSince: Date?
        var lastRow: FollowRowKind
        var rows: [String: Activity]

        mutating func setStatus(_ new: SessionStatus, at now: Date) {
            if new == .working { nonWorkingSince = nil } else if nonWorkingSince == nil { nonWorkingSince = now }
            status = new
        }

        mutating func record(_ activity: Activity) -> Bool {
            guard rows[activity.id] != activity else { return false }
            if rows[activity.id] == nil { lastRow = FollowRowKind(activity) }
            rows[activity.id] = activity
            return true
        }
    }

    private static let tickInterval: Duration = .seconds(1)

    let workspace: Workspace
    let api: FardeskAPI
    let sessionID: String
    let printed: [FardeskModels.Activity]
    /// Return when the turn really ended or the session needs the user, instead of running until cancelled.
    var endsWithTurn = false
    var timeout: TimeInterval = FollowStop.defaultTimeout

    func run() async throws {
        let startedAt = workspace.context.now()
        var progress = Progress(
            lastRow: FollowRowKind(printed.last),
            rows: Dictionary(printed.map { ($0.id, $0) }, uniquingKeysWith: { _, newer in newer })
        )
        for await step in steps() {
            let now = workspace.context.now()
            switch step {
            case .failed(let error): throw error
            case .tick: break
            case .update(let update):
                guard case .event(let event) = update else { continue }
                if try await apply(event, to: &progress, at: now) { return }
            }
            guard endsWithTurn else { continue }
            let stop = FollowStop.decide(
                status: progress.status, lastRowKind: progress.lastRow,
                nonWorkingSince: progress.nonWorkingSince, now: now, startedAt: startedAt, timeout: timeout
            )
            if try await finish(stop, progress) { return }
        }
    }

    /// True when the session is not listed any more and the turn cannot continue.
    private func apply(_ event: StreamEvent, to progress: inout Progress, at now: Date) async throws -> Bool {
        switch event {
        case .hello(_, let sessions):
            guard let listed = sessions.first(where: { $0.id == sessionID }) else { return endsWithTurn }
            progress.setStatus(listed.status, at: now)
        case .session(let changed) where changed.id == sessionID:
            progress.setStatus(changed.status, at: now)
        case .activity(let eventSession, let activity) where eventSession == sessionID:
            if progress.record(activity) { workspace.print(try FeedRenderer.render([activity], options: workspace.options)) }
        default: break
        }
        return false
    }

    /// True when following ends; prints the pending request and a hint first when the session needs the user.
    private func finish(_ stop: FollowStop, _ progress: Progress) async throws -> Bool {
        switch stop {
        case .keepGoing: return false
        case .turnEnded: return true
        case .needsYou:
            try await printPending(known: progress.rows)
            return true
        case .timedOut:
            throw CLIError.failed("Stopped following after \(Int(timeout)) s; the session is still working. Follow on: fardesk activity \(ShortID.short(sessionID)) --follow")
        }
    }

    private func printPending(known: [String: Activity]) async throws {
        let rows = try await api.activity(sessionID: sessionID).items
        let fresh = rows.filter { known[$0.id] != $0 }
        if !fresh.isEmpty { workspace.print(try FeedRenderer.render(fresh, options: workspace.options)) }
        if let hint = FollowStop.hint(for: rows, sessionID: sessionID) { workspace.print(hint) }
    }

    /// The daemon's stream plus a one-second clock, so the settle time and the timeout fire without new events.
    private func steps() -> AsyncStream<Step> {
        AsyncStream { continuation in
            let pump = Task {
                do {
                    for try await update in ReconnectingStream(api: api).updates() { continuation.yield(.update(update)) }
                } catch {
                    continuation.yield(.failed(error))
                }
                continuation.finish()
            }
            let clock = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.tickInterval)
                    continuation.yield(.tick)
                }
            }
            continuation.onTermination = { _ in pump.cancel(); clock.cancel() }
        }
    }
}
