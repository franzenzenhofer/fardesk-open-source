import FardeskStore
import SwiftUI

/// Adds a machine by name and address and logs in to it once with a password.
struct AddMachineSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var address = ""
    @State private var password = ""
    @State private var isAdding = false

    private var url: URL? { URL(string: address.trimmingCharacters(in: .whitespaces)) }
    private var canAdd: Bool { url?.host() != nil && !password.isEmpty && !isAdding }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                TextField("URL", text: $address)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                SecureField("Password", text: $password)
            }
            .formStyle(.grouped)
            .navigationTitle("Add Machine")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: add).disabled(!canAdd) }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 280)
        #endif
    }

    private func add() {
        guard let url else { return }
        isAdding = true
        let entered = (name, password)
        password = ""
        Task {
            if await model.addMachine(url: url, name: entered.0, password: entered.1) { dismiss() }
            isAdding = false
        }
    }
}
