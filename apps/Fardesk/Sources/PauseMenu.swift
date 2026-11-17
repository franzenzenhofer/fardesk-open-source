import FardeskStore
import SwiftUI

/// The bell in the Machines toolbar: pause every machine's pushes for an hour, until 8:00, or resume.
struct PauseMenu: View {
    private static let morningHour = 8

    @Environment(AppModel.self) private var model
    @Environment(SharedClock.self) private var clock

    var body: some View {
        let paused = PausePresentation.label(pausedUntil: model.pausedUntil, now: clock.now)
        Menu {
            if let paused { Text(paused) }
            Button("Pause 1 hour", systemImage: "bell.slash") { pause(PausePresentation.oneHour) }
            Button("Pause until \(Self.morningHour):00", systemImage: "moon") {
                pause(PausePresentation.minutes(untilHour: Self.morningHour, now: Date()))
            }
            Button("Resume notifications", systemImage: "bell") { pause(0) }
        } label: {
            if let paused {
                Label(paused, systemImage: "bell.slash.fill").font(.body)
            } else {
                ToolbarIcon(systemName: "bell")
            }
        }
        .accessibilityLabel(paused ?? "Notifications")
    }

    private func pause(_ minutes: Int) {
        Task { await model.pauseNotifications(minutes: minutes) }
    }
}
