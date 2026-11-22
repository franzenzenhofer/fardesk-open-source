import FardeskModels
import FardeskStore
import SwiftUI

/// Settings, laid out like the iOS Settings app: a short grouped list, every row opens one screen (Settings/*.swift).
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(DemoMode.self) private var demo
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.isDemo { Section { DemoNoticeLine() } }
                Section {
                    link("Machines", "desktopcomputer", .machines, detail: "\(model.state.machines.count)")
                    link("Order in list", "arrow.up.arrow.down", .machineOrder)
                    link("This device", "iphone", .thisDevice)
                }
                Section {
                    link("Notifications", "bell", .notifications)
                    link("Appearance", "paintpalette", .appearance)
                    link("Hidden chats", "eye.slash", .hiddenChats)
                }
                Section {
                    link("Voice", "mic", .voice)
                    link("Security", "lock", .security)
                    link("Data", "externaldrive", .data)
                }
                demoSection
                Section { link("About", "info.circle", .about) }
                DangerZone()
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: SettingsPage.self) { $0.destination() }
        }
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 640, idealHeight: 760)
        #endif
    }

    private func link(_ title: String, _ symbol: String, _ page: SettingsPage, detail: String? = nil) -> some View {
        NavigationLink(value: page) { SettingsRow(title: title, symbol: symbol, detail: detail) }
            .accessibilityIdentifier("settings-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))")
    }

    /// In the demo: the way out. Otherwise: the way in (sample sessions on pretend machines, no computer needed).
    @ViewBuilder
    private var demoSection: some View {
        if model.isDemo {
            Section {
                Button("Leave demo") { demo.leave() }.accessibilityIdentifier("settings-demo-leave")
            } header: {
                Text("Demo")
            } footer: {
                SettingsFooter("This is sample data. Nothing leaves this device.")
            }
        } else {
            Section {
                Button("See a demo") {
                    dismiss()
                    demo.enter()
                }
                .accessibilityIdentifier("settings-demo")
            } footer: {
                SettingsFooter("Sample sessions on pretend machines, without a computer.")
            }
        }
    }
}
