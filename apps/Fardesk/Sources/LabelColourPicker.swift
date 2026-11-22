import FardeskModels
import FardeskStore
import SwiftUI

/// The colour choice for a session: the 64 presets as a grid (one tap each), "no colour", and the system colour
/// picker for any other colour. Used in the Session info sheet and in the "More colours" sheet.
struct LabelColourPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.self) private var environment
    let ref: SessionRef
    let session: SessionSummary
    /// Runs after a tap on a preset or "No colour": the "More colours" sheet closes on it, so a tap is the whole step.
    var onPicked: () -> Void = {}
    @State private var custom: Color = .blue
    @State private var pending: Task<Void, Never>?

    private let customDelay = Duration.milliseconds(500)
    private var current: LabelColor? { session.label.color }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 4)], alignment: .leading, spacing: 4) {
                NoColourButton(isCurrent: current == nil) { apply(nil) }
                ForEach(LabelPalette.presets, id: \.color) { preset in
                    PresetButton(preset: preset, isCurrent: current == preset.color) { apply(preset.color) }
                }
            }
            ColorPicker("Any other colour", selection: $custom, supportsOpacity: false)
                .accessibilityIdentifier("colour-custom-picker")
                .onChange(of: custom) { _, picked in applyCustomAfterPause(picked) }
        }
        .onAppear { if let current { custom = current.swatch } }
    }

    private func apply(_ color: LabelColor?) {
        pending?.cancel()
        Task { await model.label(.color(color), ref) }
        onPicked()
    }

    /// The system picker reports every step of a drag; only the colour it rests on is sent.
    private func applyCustomAfterPause(_ picked: Color) {
        pending?.cancel()
        let color = LabelColor(picked, in: environment)
        guard color != current else { return }
        pending = Task {
            try? await Task.sleep(for: customDelay)
            guard !Task.isCancelled else { return }
            await model.label(.color(color), ref)
        }
    }
}

private extension View {
    /// The 44 pt target of a swatch, with a ring around it when it is the current one.
    func swatchSlot(isCurrent: Bool) -> some View {
        padding(3)
            .overlay { if isCurrent { Circle().strokeBorder(.primary, lineWidth: 2.5) } }
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

/// One preset: a filled dot with its name for VoiceOver, ringed and ticked when it is the current one.
private struct PresetButton: View {
    let preset: LabelPreset
    let isCurrent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(preset.color.swatch)
                if isCurrent { Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(preset.color.markColor) }
            }
            .frame(width: 30, height: 30)
            .swatchSlot(isCurrent: isCurrent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(preset.name)
        .accessibilityIdentifier("colour-preset-\(preset.color.hex)")
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

/// "No colour": an empty ring with a slash, ringed when no colour is set.
private struct NoColourButton: View {
    let isCurrent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "slash.circle")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
                .frame(width: 30, height: 30)
                .swatchSlot(isCurrent: isCurrent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("No colour")
        .accessibilityIdentifier("colour-none")
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

/// The "More colours" entry of the long-press menu: the whole picker in a sheet.
struct LabelColourSheet: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator

    private var isPresented: Binding<Bool> {
        Binding(get: { coordinator.colourTarget != nil }, set: { if !$0 { coordinator.colourTarget = nil } })
    }

    func body(content: Content) -> some View {
        content.sheet(isPresented: isPresented) {
            NavigationStack {
                ScrollView {
                    if let ref = coordinator.colourTarget, let session = model.session(ref) {
                        LabelColourPicker(ref: ref, session: session) { coordinator.colourTarget = nil }.padding()
                    }
                }
                .navigationTitle("Colour")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { coordinator.colourTarget = nil } } }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

extension View {
    func sheetsLabelColours() -> some View { modifier(LabelColourSheet()) }
}
