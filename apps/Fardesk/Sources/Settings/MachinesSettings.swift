import FardeskModels
import FardeskStore
import SwiftUI

/// Settings > Machines: the paired computers in the order the owner chose (drag to change it), and a way to add one.
struct MachinesSettings: View {
    @Environment(AppModel.self) private var model
    @State private var showsAddMachine = false

    var body: some View {
        List {
            Section {
                ForEach(model.state.machines) { machine in
                    let presentation = MachinePresentation(machine: machine, now: Date())
                    NavigationLink(value: SettingsPage.machine(machine.id)) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(presentation.name)
                                Spacer()
                                MachineStatusBadge(presentation: presentation)
                            }
                            MachineVersionLine(machine: machine)
                        }
                    }
                }
                if !model.isHubMode {
                    Button("Add machine", systemImage: "plus") { showsAddMachine = true }
                        .disabledInDemo(.addMachine)
                        .accessibilityIdentifier("settings-add-machine")
                }
            }
            if model.showsUpdateLine {
                Section { UpdateSettingsRow() }
            }
            Section {
                NavigationLink(value: SettingsPage.machineOrder) {
                    SettingsRow(title: "Order in list", symbol: "arrow.up.arrow.down")
                }
                .accessibilityIdentifier("settings-machine-order")
            } footer: {
                SettingsFooter("Which machine comes first on the list page.")
            }
        }
        .navigationTitle("Machines")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $showsAddMachine) { PairingSheet() }
    }
}

/// One machine: its name, where it is, whether it answers (and why not), and the way to forget it.
struct MachineDetailView: View {
    let machineID: UUID
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsRemoval = false

    var body: some View {
        Group {
            if let machine = model.state.machines.first(where: { $0.id == machineID }) {
                content(machine)
            } else {
                Text("This machine is no longer paired.").font(.body).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Machine")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func content(_ machine: MachineState) -> some View {
        let presentation = MachinePresentation(machine: machine, now: Date())
        return List {
            Section {
                LabeledContent("Name", value: presentation.name)
                LabeledContent("Address") { Text(machine.endpoint.url.absoluteString).textSelection(.enabled) }
                LabeledContent("Status") { MachineStatusBadge(presentation: presentation) }
                if let since = presentation.offlineSinceLabel {
                    LabeledContent("Offline", value: since)
                }
                if let info = machine.machine {
                    LabeledContent("Fardesk daemon", value: info.version)
                    if !info.isCompatible || model.updatePlan.needsUpdate(machineID) {
                        MachineVersionLine(machine: machine)
                        if model.updatePlan.needsUpdate(machineID) { UpdateAllButton() }
                    }
                }
            } footer: {
                if let problem = presentation.problem {
                    SettingsFooter(problem)
                } else if machine.connection == .loggedOut {
                    SettingsFooter("This machine no longer accepts this device. Pair it again to use it.")
                }
            }
            if machine.machine?.ghosttyAutomation == .denied {
                Section {
                    Text("Allow Fardesk to control Ghostty: System Settings > Privacy & Security > Automation.").font(.body)
                }
            }
            if !model.isHubMode {
                Section {
                    Button("Remove this machine", role: .destructive) { confirmsRemoval = true }
                        .disabledInDemo(.addMachine)
                        .accessibilityIdentifier("settings-remove-machine")
                } footer: {
                    SettingsFooter("Forgets the pairing on this device. Nothing is deleted on the computer.")
                }
            }
        }
        .confirmationDialog("Remove \(presentation.name)?", isPresented: $confirmsRemoval, titleVisibility: .visible) {
            Button("Remove this machine", role: .destructive) {
                model.removeMachine(id: machineID)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}
