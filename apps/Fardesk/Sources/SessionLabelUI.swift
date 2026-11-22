import FardeskModels
import FardeskStore
import SwiftUI

/// Rename, Colour and Pin: the user's own label on a session (docs/design/SESSION-LABELS.md), in the row's
/// long-press menu and the "Actions" menu.
struct SessionLabelButtons: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        Section {
            Button("Rename", systemImage: "pencil") { coordinator.renameTarget = ref }
            Menu("Colour", systemImage: "paintpalette") {
                Picker("Colour", selection: choice) {
                    ForEach(LabelPalette.quick, id: \.color) { preset in
                        Label { Text(preset.name) } icon: { preset.color.menuDot }.tag(Optional(preset.color))
                    }
                }
                .pickerStyle(.palette)
                // iOS keeps a menu open after a tap on a palette (to allow several taps): one tap picks the colour
                // and closes the menu here, so the list is back at once.
                .menuActionDismissBehavior(.enabled)
                Button("More colours", systemImage: "ellipsis.circle") { coordinator.colourTarget = ref }
                if session.label.color != nil {
                    Button("No colour", systemImage: "circle.slash") { apply(.color(nil)) }
                }
            }
            PinButton(ref: ref, session: session)
        }
    }

    private var choice: Binding<LabelColor?> {
        Binding(get: { session.label.color }, set: { apply(.color($0)) })
    }

    private func apply(_ request: LabelRequest) {
        Task { await model.label(request, ref) }
    }
}

/// Pin / Unpin: pinned sessions come first in their machine and stay listed after they end.
struct PinButton: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        let pinned = session.label.pinned
        Button(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") {
            Task { await model.label(.pin(!pinned), ref) }
        }
        .accessibilityIdentifier("pin-\(session.id)")
    }
}

/// The Name, Colour and Pinned sections of the Session info sheet, each its own section, edited in place (an alert cannot show over
/// a sheet). The colour choice has no row title of its own: the grid is the row.
struct SessionLabelEditor: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let session: SessionSummary
    @State private var draft = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        Section {
            TextField("Name", text: $draft, prompt: Text(session.title))
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit(saveName)
                .onChange(of: nameFocused) { _, focused in if !focused { saveName() } }
                .accessibilityIdentifier("label-name-field")
        } header: {
            Text("Name")
        } footer: {
            Text("Your own name for this chat, shown instead of its title.")
        }
        .onAppear { draft = session.label.name ?? "" }
        Section("Colour") {
            LabelColourPicker(ref: ref, session: session)
        }
        ChatImageEditor(ref: ref, session: session)
        Section {
            Toggle("Pinned", isOn: Binding(get: { session.label.pinned }, set: { apply(.pin($0)) }))
        } footer: {
            Text("Pinned chats stay at the top of their computer.")
        }
    }

    private func saveName() {
        let name = SessionLabelName.normalised(draft, title: session.title)
        guard name != session.label.name else { return }
        apply(.rename(name))
    }

    private func apply(_ request: LabelRequest) {
        Task { await model.label(request, ref) }
    }
}
