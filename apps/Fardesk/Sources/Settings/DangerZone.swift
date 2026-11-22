import FardeskStore
import SwiftUI

/// The last group of Settings: log out of every machine, or reset Fardesk completely. Both ask first.
struct DangerZone: View {
    @Environment(AppModel.self) private var model
    @State private var confirmsLogout = false
    @State private var confirmsReset = false

    var body: some View {
        Section {
            Button("Log out of all machines", role: .destructive) { confirmsLogout = true }
                .disabledInDemo(.logOut)
                .accessibilityIdentifier("settings-log-out")
            Button("Reset Fardesk", role: .destructive) { confirmsReset = true }
                .disabledInDemo(.logOut)
                .accessibilityIdentifier("settings-reset")
        } header: {
            Text("Danger zone")
        } footer: {
            SettingsFooter("Logging out signs this device out of your machines. Resetting also deletes every setting and cached chat on this device.")
        }
        .confirmationDialog("Log out of all machines?", isPresented: $confirmsLogout, titleVisibility: .visible) {
            Button("Log out", role: .destructive) {
                let token = AppServices.shared.apnsToken
                Task { await model.logout(apnsToken: token) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Reset Fardesk?", isPresented: $confirmsReset, titleVisibility: .visible) {
            Button("Reset Fardesk", role: .destructive) {
                let token = AppServices.shared.apnsToken
                Task { await model.resetFardesk(apnsToken: token, settings: .ofThisApp()) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This device is signed out of every machine and forgets all settings and cached chats. Fardesk starts as new. Nothing is deleted on your computers.")
        }
    }
}
