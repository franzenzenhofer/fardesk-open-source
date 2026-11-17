import FardeskStore
import SwiftUI

/// The small "dot + status" shown wherever a machine's connection state appears.
struct MachineStatusBadge: View {
    let presentation: MachinePresentation

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "circle.fill")
                .font(.caption2)
                .foregroundStyle(StateColor.color(presentation.state))
            Text(presentation.statusLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
