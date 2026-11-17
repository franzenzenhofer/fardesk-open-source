import FardeskModels
import FardeskStore
import SwiftUI

/// Devices registered on each machine; swipe to revoke one, or revoke all of a machine.
struct DevicesSection: View {
    @Environment(AppModel.self) private var model
    @State private var machines: [MachineDevices] = []
    @State private var revokeAll: MachineDevices?
    @State private var isLoading = false

    var body: some View {
        Group {
            if isLoading && machines.isEmpty {
                Section("Devices") {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Reading devices...").foregroundStyle(.secondary)
                    }
                }
            }
            ForEach(machines, id: \.machineID) { machine in
                Section("Devices on \(machine.machineName)") {
                    if let problem = machine.problem {
                        Text(problem).font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(machine.devices) { device in
                        row(device).swipeActions { revokeButton(device, on: machine) }
                    }
                    if !machine.devices.isEmpty {
                        Button("Revoke all", role: .destructive) { revokeAll = machine }
                    }
                }
            }
        }
        .task { await reload() }
        .confirmationDialog(
            "Revoke every device?",
            isPresented: Binding(get: { revokeAll != nil }, set: { if !$0 { revokeAll = nil } }),
            titleVisibility: .visible
        ) {
            Button("Revoke all", role: .destructive) { revoke(nil, on: revokeAll) }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func row(_ device: AuthDevice) -> some View {
        LabeledContent {
            Text(device.lastSeenAt.map { RelativeTimeFormat.short(from: $0, to: Date()) } ?? "Never")
        } label: {
            Text(device.current ? "\(device.name) (this device)" : device.name)
        }
    }

    private func revokeButton(_ device: AuthDevice, on machine: MachineDevices) -> some View {
        Button("Revoke", role: .destructive) { revoke(device.id, on: machine) }
    }

    private func revoke(_ device: String?, on machine: MachineDevices?) {
        guard let machine else { return }
        Task {
            _ = await model.revoke(device: device, on: machine.machineID)
            await reload()
        }
    }

    /// Each machine shows up the moment it answers; a slow one never holds the others back.
    private func reload() async {
        isLoading = true
        for await machine in model.deviceUpdates() {
            machines.removeAll { $0.machineID == machine.machineID }
            machines.append(machine)
            machines.sort { $0.machineName < $1.machineName }
        }
        isLoading = false
    }
}
