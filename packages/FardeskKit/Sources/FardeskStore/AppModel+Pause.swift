import FardeskClient
import FardeskModels
import Foundation

/// The next `hour`:00 after `now`, as minutes from now (at least 1), for "Pause until 8:00".
public enum PausePresentation {
    public static let oneHour = 60

    public static func minutes(untilHour hour: Int, now: Date, calendar: Calendar = .current) -> Int {
        let target = calendar.nextDate(
            after: now, matching: DateComponents(hour: hour, minute: 0, second: 0), matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(TimeInterval(oneHour * 60))
        return max(1, Int((target.timeIntervalSince(now) / 60).rounded(.up)))
    }

    /// "Paused until 10:42", or nil when nothing is paused.
    public static func label(pausedUntil: Date?, now: Date, calendar: Calendar = .current) -> String? {
        guard let pausedUntil, pausedUntil > now else { return nil }
        return "Paused until \(clock(pausedUntil, calendar: calendar))"
    }

    public static func clock(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

extension AppModel {
    /// Pauses (or with 0 resumes) the pushes of every machine. True when at least one machine took it.
    @discardableResult
    public func pauseNotifications(minutes: Int) async -> Bool {
        var accepted = false
        showNotice(ActionFeedback(text: minutes == 0 ? "Resuming notifications..." : "Pausing notifications...", state: .running), in: .list)
        defer { showNotice(accepted ? ActionFeedback(text: minutes == 0 ? "Notifications resumed" : "Notifications paused", state: .succeeded) : ActionFeedback(text: "Could not change the notifications: no machine answered", state: .failed), in: .list) }
        for endpoint in machines.endpoints {
            let answer = await perform(on: endpoint.id, action: "pause the notifications", origin: .background) {
                try await $0.pauseNotifications(minutes: minutes)
            }
            guard let answer else { continue }
            setPause(answer.pausedUntil, on: endpoint.id)
            accepted = true
        }
        recordEvent("notifications", minutes == 0 ? "resumed" : "paused for \(minutes) min")
        return accepted
    }

    /// Reads one machine's pause state (when its stream connects), so the bell shows it.
    func refreshPause(of machineID: UUID) async {
        guard let answer = await perform(on: machineID, action: "read the notification pause", origin: .background, {
            try await $0.notifications()
        }) else { return }
        setPause(answer.pausedUntil, on: machineID)
    }

    /// Records a machine's pause and refreshes the one value the bell reads, only when it changed.
    private func setPause(_ until: Date?, on machineID: UUID) {
        guard (try? state.machine(id: machineID))?.pausedUntil != until else { return }
        try? state.setPause(until, on: machineID)
        let latest = state.machines.compactMap(\.pausedUntil).max()
        if latest != pausedUntil { pausedUntil = latest }
    }
}
