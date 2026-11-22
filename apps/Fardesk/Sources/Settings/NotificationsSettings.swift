import FardeskModels
import FardeskStore
import SwiftUI

/// Settings > Notifications: what notifies, a pause, and the chats that were muted.
struct NotificationsSettings: View {
    var body: some View {
        List {
            NotificationsSection()
            PauseSection()
            MutedChatsSection()
        }
        .navigationTitle("Notifications")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// The pause control of the bell menu, as rows: an hour, until the morning, or resume.
private struct PauseSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let paused = PausePresentation.label(pausedUntil: model.pausedUntil, now: Date())
        Section {
            if let paused { Text(paused).font(.body.weight(.semibold)) }
            Button("Pause for 1 hour", systemImage: "bell.slash") { pause(PausePresentation.oneHour) }
            Button("Pause until \(PauseMenu.morningHour):00", systemImage: "moon") {
                pause(PausePresentation.minutes(untilHour: PauseMenu.morningHour, now: Date()))
            }
            Button("Resume notifications", systemImage: "bell") { pause(0) }.disabled(paused == nil)
        } header: {
            Text("Pause")
        } footer: {
            SettingsFooter("Stops notifications from every machine for a while.")
        }
        .foregroundStyle(.primary)
        .disabledInDemo(.notificationSettings)
    }

    private func pause(_ minutes: Int) {
        Task { await model.pauseNotifications(minutes: minutes) }
    }
}

/// Chats that were muted on any machine, each with a way to unmute it.
private struct MutedChatsSection: View {
    @Environment(AppModel.self) private var model

    private struct Muted: Identifiable {
        let ref: SessionRef
        let title: String
        let machine: String
        var id: SessionRef { ref }
    }

    private var muted: [Muted] {
        model.state.machines.flatMap { machine in
            machine.sessions.filter(\.muted).map {
                Muted(ref: SessionRef(machineID: machine.id, sessionID: $0.id), title: $0.title, machine: machine.endpoint.name)
            }
        }
    }

    var body: some View {
        let items = muted
        Section {
            if items.isEmpty {
                Text("No muted chats.").font(.body).foregroundStyle(.secondary)
            }
            ForEach(items) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).lineLimit(2)
                        Text(item.machine).font(.body).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Unmute") { Task { await model.mute(false, item.ref) } }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.primary)
                        .underline()
                        .disabledInDemo(.sessionActions)
                }
            }
        } header: {
            Text("Muted chats")
        } footer: {
            SettingsFooter("A muted chat never sends a notification.")
        }
    }
}
