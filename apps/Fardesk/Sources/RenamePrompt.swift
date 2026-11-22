import FardeskModels
import FardeskStore
import SwiftUI

/// The Rename prompt, attached once at the top of the screen like the End Session confirmation. An empty name
/// goes back to the session's own title.
struct RenamePrompt: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @State private var draft = ""

    func body(content: Content) -> some View {
        content
            .alert("Rename session", isPresented: isPresented) {
                TextField("Name", text: $draft).accessibilityIdentifier("rename-field")
                Button("Save") { save() }
                Button("Cancel", role: .cancel) { coordinator.renameTarget = nil }
            } message: {
                Text("Leave it empty to show the original title.")
            }
            .onChange(of: coordinator.renameTarget) { _, ref in
                draft = ref.flatMap { model.session($0)?.displayTitle } ?? ""
            }
    }

    private var isPresented: Binding<Bool> {
        Binding(get: { coordinator.renameTarget != nil }, set: { if !$0 { coordinator.renameTarget = nil } })
    }

    private func save() {
        guard let ref = coordinator.renameTarget else { return }
        coordinator.renameTarget = nil
        let name = SessionLabelName.normalised(draft, title: model.session(ref)?.title)
        Task { await model.label(.rename(name), ref) }
    }
}

extension View {
    func promptsRename() -> some View { modifier(RenamePrompt()) }
}
