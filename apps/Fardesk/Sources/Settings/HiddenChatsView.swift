import FardeskModels
import FardeskStore
import SwiftUI

/// Settings > Hidden chats: stopped chats that were removed from the list, per machine, each with Restore.
struct HiddenChatsView: View {
    @Environment(AppModel.self) private var model
    @State private var hidden: [UUID: [HiddenSession]] = [:]
    @State private var isLoading = true

    var body: some View {
        List {
            if isLoading && hidden.isEmpty {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Reading hidden chats...").font(.body).foregroundStyle(.secondary)
                }
            } else if hidden.values.allSatisfy(\.isEmpty) {
                Text("No hidden chats.").font(.body).foregroundStyle(.secondary)
            }
            ForEach(model.state.machines) { machine in
                if let chats = hidden[machine.id], !chats.isEmpty {
                    Section(machine.endpoint.name) {
                        ForEach(chats) { chat in row(chat, on: machine.id) }
                    }
                }
            }
        }
        .navigationTitle("Hidden chats")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    private func row(_ chat: HiddenSession, on machineID: UUID) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(chat.title).lineLimit(2)
                Text(RelativeTimeFormat.short(from: chat.updatedAt, to: Date()) + " ago")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Restore") { restore(chat, on: machineID) }
                .buttonStyle(.borderless)
                .foregroundStyle(.primary)
                .underline()
                .disabledInDemo(.sessionActions)
        }
    }

    private func restore(_ chat: HiddenSession, on machineID: UUID) {
        Task {
            guard await model.unhide(SessionRef(machineID: machineID, sessionID: chat.id)) else { return }
            hidden[machineID]?.removeAll { $0.id == chat.id }
        }
    }

    /// Each machine answers on its own; a slow one never holds the others back.
    private func load() async {
        isLoading = true
        let ids = model.state.machines.map(\.id)
        await withTaskGroup(of: (UUID, [HiddenSession]).self) { group in
            for id in ids { group.addTask { (id, await model.hiddenSessions(on: id)) } }
            for await (id, chats) in group { hidden[id] = chats }
        }
        isLoading = false
    }
}
