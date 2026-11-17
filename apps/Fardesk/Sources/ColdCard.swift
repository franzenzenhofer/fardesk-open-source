import FardeskStore
import SwiftUI

/// Shown at the bottom of the feed (not a modal) when a message waits for a cold session:
/// "Resume this conversation? Inactive for 3 h and 426k tokens long. Continuing re-reads all of it."
struct ColdCard: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef

    var body: some View {
        if let warning = model.coldWarning(for: ref), model.coldHolds[ref] != nil {
            VStack(alignment: .leading, spacing: 12) {
                Label(warning, systemImage: "snowflake").font(.body).accessibilityIdentifier("cold-warning")
                ForEach(model.coldChoices(for: ref), id: \.self) { choice in
                    Button { choose(choice) } label: { Text(choice.buttonTitle).frame(maxWidth: .infinity) }
                        .buttonStyle(FardeskButtonStyle(role: choice == .resume ? .primary : .secondary))
                        .accessibilityIdentifier("cold-\(choice.rawValue)")
                }
                Button("Cancel", role: .cancel) { model.cancelCold(for: ref) }
                    .font(.body)
                    .accessibilityIdentifier("cold-cancel")
            }
            .padding()
            .background(.secondary.opacity(0.1), in: .rect(cornerRadius: 16))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("cold-card")
        }
    }

    private func choose(_ choice: ColdChoice) {
        Task { if let next = await model.chooseCold(choice, for: ref) { coordinator.selection = next } }
    }
}
