import FardeskStore
import SwiftUI

/// Long press on a machine's header in the list: the same order list as Settings > Order in list, as a sheet.
struct MachineOrderSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            MachineOrderList()
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .accessibilityIdentifier("machine-order-sheet")
    }
}

/// The machines with drag handles, always in edit mode: the order here is the order of the list page.
struct MachineOrderList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Section {
                ForEach(model.state.machines) { machine in
                    Text(machine.endpoint.name).font(.body)
                }
                .onMove { model.moveMachines(from: $0, to: $1) }
            } footer: {
                SettingsFooter("Drag a machine by its handle. The first one comes first on the list page.")
            }
        }
        #if os(iOS)
        .environment(\.editMode, .constant(.active))
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationTitle("Order in list")
        .accessibilityIdentifier("machine-order-list")
    }
}

/// The plain reason an offline computer does not answer (`OfflineReason`), shown when its header is tapped.
struct OfflineReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let reason: OfflineReason

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(reason.reason).font(.body)
                Text(reason.whatToDo).font(.body).foregroundStyle(.secondary)
                Spacer()
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .navigationTitle(reason.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
        .accessibilityIdentifier("offline-reason-sheet")
    }
}
