import FardeskStore
import SwiftUI

/// "Load earlier messages": underlined so it reads as something to tap, with a small spinner while the page loads.
struct LoadEarlierButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading { ProgressView().controlSize(.small) }
                Text(isLoading ? "Loading earlier messages" : "Load earlier messages").underline()
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityIdentifier("load-earlier")
    }
}

/// The line between the rows that just arrived and the ones that were there: "12 earlier messages loaded".
struct EarlierRowsMark: View {
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            line
            Text(label).font(.footnote).foregroundStyle(.secondary).fixedSize()
            line
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("earlier-loaded")
    }

    private var line: some View { Rectangle().fill(.separator).frame(height: 1) }
}

/// A row that just arrived from "Load earlier": it fades in instead of popping in, so the user sees it is new.
struct FadesInWhenNew: ViewModifier {
    let isNew: Bool
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(isNew && !shown ? 0 : 1)
            .offset(y: isNew && !shown ? -8 : 0)
            .onAppear {
                guard isNew, !shown else { return }
                withAnimation(.easeOut(duration: 0.45)) { shown = true }
            }
    }
}
