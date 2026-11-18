import FardeskModels
import FardeskStore
import SwiftUI
#if os(iOS)
import UIKit
#endif

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
                ForEach(LabelColor.allCases, id: \.self) { color in
                    Button { apply(.color(color)) } label: { LabelColorMenuItem(color: color, isCurrent: session.label.color == color) }
                }
                if session.label.color != nil {
                    Button("No colour", systemImage: "circle.slash") { apply(.color(nil)) }
                }
            }
            PinButton(ref: ref, session: session)
        }
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

/// A colour in the Colour menu: a dot in the colour itself (menus draw symbols in one colour, so on iOS the dot
/// is an image with its colour baked in) and a check on the current one.
private struct LabelColorMenuItem: View {
    let color: LabelColor
    let isCurrent: Bool

    var body: some View {
        Label {
            Text(isCurrent ? "\(color.displayName) (current)" : color.displayName)
        } icon: {
            #if os(iOS)
            Image(uiImage: Self.dot(color))
            #else
            Image(systemName: "circle.fill").foregroundStyle(color.swatch)
            #endif
        }
    }

    #if os(iOS)
    private static func dot(_ color: LabelColor) -> UIImage {
        let image = UIImage(systemName: "circle.fill") ?? UIImage()
        return image.withTintColor(UIColor(color.swatch), renderingMode: .alwaysOriginal)
    }
    #endif
}

/// The colour label of a row: a bar in the row's leading margin, so titles stay aligned with or without one.
struct LabelColorBar: View {
    let color: LabelColor?

    var body: some View {
        if let color {
            Capsule()
                .fill(color.swatch)
                .frame(width: 5, height: 38)
                .offset(x: -14)
                .accessibilityLabel("Colour \(color.displayName)")
        }
    }
}

/// The label part of the Session info sheet: name, colour and pin, edited in place (an alert cannot show over
/// a sheet).
struct SessionLabelEditor: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let session: SessionSummary
    @State private var draft = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        Section("Your label") {
            TextField("Name", text: $draft, prompt: Text(session.title))
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit(saveName)
                .onChange(of: nameFocused) { _, focused in if !focused { saveName() } }
                .accessibilityIdentifier("label-name-field")
            HStack(spacing: 14) {
                Text("Colour")
                Spacer()
                ColorSwatchButton(color: nil, isCurrent: session.label.color == nil) { apply(.color(nil)) }
                ForEach(LabelColor.allCases, id: \.self) { color in
                    ColorSwatchButton(color: color, isCurrent: session.label.color == color) { apply(.color(color)) }
                }
            }
            Toggle("Pinned", isOn: Binding(get: { session.label.pinned }, set: { apply(.pin($0)) }))
        }
        .onAppear { draft = session.label.name ?? "" }
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

/// One colour choice: a filled dot, ringed when it is the current one; "none" is an empty ring with a slash.
private struct ColorSwatchButton: View {
    let color: LabelColor?
    let isCurrent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if let color {
                    Circle().fill(color.swatch)
                } else {
                    Circle().strokeBorder(.secondary, lineWidth: 1.5)
                    Image(systemName: "slash.circle").foregroundStyle(.secondary)
                }
            }
            .frame(width: 26, height: 26)
            .padding(3)
            .overlay { if isCurrent { Circle().strokeBorder(.primary, lineWidth: 2) } }
            .frame(minWidth: 34, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(color?.displayName ?? "No colour")
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

extension LabelColor {
    /// The colour on screen. System colours, so light and dark mode both stay clear.
    var swatch: Color {
        switch self {
        case .blue: .blue
        case .teal: .teal
        case .purple: .purple
        case .pink: .pink
        }
    }
}

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
