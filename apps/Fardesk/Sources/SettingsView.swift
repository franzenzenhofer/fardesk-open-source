import FardeskModels
import FardeskStore
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppServices.requireFaceIDKey) private var requiresFaceID = false
    @State private var confirmsLogout = false
    @State private var showsAddMachine = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                machinesSection
                NotificationsSection()
                Section("Voice") { ReadAloudRow(); VoiceAttachRow() }
                Section("Security") { Toggle("Require Face ID", isOn: $requiresFaceID) }
                DevicesSection()
                Section {
                    Button("Log Out", role: .destructive) { confirmsLogout = true }
                } footer: {
                    Text("Fardesk \(version)").font(.footnote).frame(maxWidth: .infinity)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Log out of all machines?", isPresented: $confirmsLogout, titleVisibility: .visible) {
                Button("Log Out", role: .destructive) { logout() }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(isPresented: $showsAddMachine) { AddMachineSheet() }
        }
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 760, idealHeight: 820)
        #endif
    }

    private var machinesSection: some View {
        Section("Machines") {
            ForEach(model.state.machines) { machine in
                let presentation = MachinePresentation(machine: machine, now: Date())
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(presentation.name)
                        Spacer()
                        MachineStatusBadge(presentation: presentation)
                    }
                    if machine.machine?.ghosttyAutomation == .denied {
                        Text("Allow Fardesk to control Ghostty: System Settings > Privacy & Security > Automation.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    if !model.isHubMode {
                        Button("Delete", role: .destructive) { model.removeMachine(id: machine.id) }
                    }
                }
            }
            if !model.isHubMode { Button("Add Machine", systemImage: "plus") { showsAddMachine = true } }
        }
    }

    private func logout() {
        let token = AppServices.shared.apnsToken
        Task { await model.logout(apnsToken: token) }
    }
}
