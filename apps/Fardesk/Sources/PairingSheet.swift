import FardeskStore
import SwiftUI

struct PairingSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var isPairing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("fardesk://pair?...", text: $link, axis: .vertical)
                        .lineLimit(3...6)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                } footer: {
                    if isPairing {
                        Label("Checking the link with \(model.hubDisplayName)...", systemImage: "hourglass").font(.body)
                    } else if let error = model.loginError {
                        Text(error).font(.body).foregroundStyle(StateColor.broken)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Pairing Link")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isPairing ? "Pairing..." : "Pair", action: pair).disabled(link.isEmpty || isPairing)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 240)
        #endif
    }

    private func pair() {
        let entered = link
        isPairing = true
        Task {
            await model.pair(link: entered)
            isPairing = false
            if model.phase == .ready { dismiss() }
        }
    }
}
