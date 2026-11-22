import FardeskStore
import SwiftUI

/// Settings > Data: the chats kept on this device for offline use, and a text to attach to a bug report.
struct DataSettings: View {
    @Environment(AppModel.self) private var model
    @State private var confirmsClear = false
    @State private var copied = false

    var body: some View {
        List {
            Section {
                Button("Clear cached chats", role: .destructive) { confirmsClear = true }
                    .disabled(model.isDemo)
                    .accessibilityIdentifier("settings-clear-cache")
            } footer: {
                SettingsFooter("Deletes the chats this device keeps for offline use. They load again from your machines when you open them.")
            }
            Section {
                Button(copied ? "Copied" : "Copy diagnostics", systemImage: "doc.on.doc") {
                    Clipboard.copy(model.diagnosticsText())
                    copied = true
                }
                .foregroundStyle(.primary)
                .accessibilityIdentifier("settings-copy-diagnostics")
            } footer: {
                SettingsFooter("Copies the app version, the state of every machine and the latest errors, to paste into a message. It contains no passwords or addresses.")
            }
        }
        .navigationTitle("Data")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .confirmationDialog("Clear cached chats?", isPresented: $confirmsClear, titleVisibility: .visible) {
            Button("Clear cached chats", role: .destructive) { model.clearCachedChats() }
            Button("Cancel", role: .cancel) {}
        }
    }
}
