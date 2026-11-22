import FardeskModels
import FardeskStore
import SwiftUI

/// The navigation title: the project name over "machine, folder, status". A status dot, no spinner. Tapping it
/// opens everything known about the session.
struct SessionTitleView: View {
    let ref: SessionRef
    let title: String
    let line: SessionHeaderLine
    let session: SessionSummary
    let machineName: String
    @State private var showsInfo = false

    var body: some View {
        Button { showsInfo = true } label: {
            VStack(spacing: 2) {
                Text(title).font(.headline).lineLimit(1)
                HStack(spacing: 5) {
                    Circle().fill(dotColor).frame(width: 8, height: 8)
                    Text(line.statusLabel).foregroundStyle(statusColor)
                    Text(FeedSymbol.separator + line.leadText).lineLimit(1)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("session-title")
        .accessibilityHint("Shows everything about this session")
        .sheet(isPresented: $showsInfo) { SessionInfoSheet(ref: ref, title: title, session: session, machineName: machineName) }
    }

    private var dotColor: Color { StateColor.color(line.tone) }

    /// The word is only coloured when it needs the user; "Working" next to a green dot says enough in grey.
    private var statusColor: Color { line.tone == .needsYou ? StateColor.needsYou : StateColor.inactive }
}

/// The full name and every fact about a session, in one sheet.
struct SessionInfoSheet: View {
    @Environment(\.dismiss) private var dismiss
    let ref: SessionRef
    let title: String
    let session: SessionSummary
    let machineName: String

    var body: some View {
        NavigationStack {
            List {
                Section { Text(title).font(.title3.weight(.semibold)).textSelection(.enabled) }
                SessionLabelEditor(ref: ref, session: session)
                Section {
                    ForEach(SessionFacts(session: session, machineName: machineName).rows, id: \.label) { row in
                        LabeledContent(row.label) { Text(row.value).textSelection(.enabled).multilineTextAlignment(.trailing) }
                    }
                }
                if !session.summary.isEmpty {
                    Section("Last step") { Text(session.summary).textSelection(.enabled) }
                }
            }
            .navigationTitle("Session")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
