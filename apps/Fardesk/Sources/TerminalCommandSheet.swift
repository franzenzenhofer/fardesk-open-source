import FardeskModels
import FardeskStore
import SwiftUI

/// SPEC 4.2 "Open in terminal": the `claude --resume` command for a session, with a Copy button.
struct TerminalCommandSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let ref: SessionRef
    @State private var copied = false

    private var session: SessionSummary? {
        try? model.state.machine(id: ref.machineID).sessions.first { $0.id == ref.sessionID }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let session {
                    let presentation = SessionPresentation(session: session, now: Date())
                    Section {
                        Text(presentation.terminalCommand)
                            .font(.body.monospaced())
                            .textSelection(.enabled)
                        Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                            Clipboard.copy(presentation.terminalCommand)
                            copied = true
                        }
                    } footer: {
                        Text("Run it in \(presentation.folderLabel) on \(machineName).")
                    }
                } else {
                    ContentUnavailableView("Session not found", systemImage: "terminal")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Open in terminal")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 240)
        #endif
        .presentationDetents([.medium])
    }

    private var machineName: String {
        (try? model.state.machine(id: ref.machineID).endpoint.name) ?? "the machine"
    }
}
