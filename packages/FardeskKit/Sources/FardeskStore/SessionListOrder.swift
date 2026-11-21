import FardeskModels
import Foundation

/// The stable session list of one machine. Pure: `MachineState` feeds it each change and reads the rows back.
///
/// Two rules keep rows from jumping:
/// 1. The sort time is the last event that matters to the user (the session appeared, its status or what it waits
///    for changed), never the daemon's `updatedAt`, which moves on every transcript line.
/// 2. The shown order is held during active use: it only gains new rows, loses gone rows, and moves a row that
///    newly needs the user (or was pinned or unpinned) to its sorted place. Everything else waits for `release`,
///    which the app calls on pull to refresh and when the owner returns after a pause.
struct SessionListOrder: Equatable, Sendable {
    private(set) var sortedAt: [String: Date] = [:]
    /// The order the list is meant to have right now.
    private(set) var target: [String] = []
    /// The order the list shows: the first fill equals `target`; afterwards it is always held.
    private(set) var shown: [String] = []

    /// Records the events in `sessions` against `previous` and returns the ids that must move at once.
    mutating func note(_ sessions: [SessionSummary], previous: [SessionSummary]) -> Set<String> {
        let before = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
        var immediate = Set<String>()
        var times: [String: Date] = [:]
        for session in sessions {
            guard let old = before[session.id] else {
                times[session.id] = sortedAt[session.id] ?? session.updatedAt
                immediate.insert(session.id)
                continue
            }
            let changed = old.status != session.status || old.waitingFor != session.waitingFor
            times[session.id] = changed ? session.updatedAt : (sortedAt[session.id] ?? session.updatedAt)
            if session.status == .waiting, old.status != .waiting { immediate.insert(session.id) }
            if old.label.pinned != session.label.pinned { immediate.insert(session.id) }
        }
        sortedAt = times
        return immediate
    }

    /// Sets the wanted order and updates what is shown: all of it when not held, else only the allowed changes.
    mutating func update(target newTarget: [String], immediate: Set<String>) {
        target = newTarget
        guard !shown.isEmpty else {
            shown = newTarget
            return
        }
        let wanted = Set(newTarget)
        var result = shown.filter { wanted.contains($0) && !immediate.contains($0) }
        for (index, id) in newTarget.enumerated() where !result.contains(id) {
            let anchor = newTarget[..<index].last { result.contains($0) }
            let position = anchor.flatMap { result.firstIndex(of: $0) }.map { $0 + 1 } ?? 0
            result.insert(id, at: position)
        }
        shown = result
    }

    /// Applies every held move (pull to refresh, or the owner came back after a pause).
    mutating func release() {
        shown = target
    }
}
