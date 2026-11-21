import FardeskStore
import SwiftUI

/// One check (sent) or two overlapping checks (Claude got it), right-aligned under the bubble.
struct DeliveryMarkView: View {
    let mark: DeliveryMark

    var body: some View {
        HStack(spacing: -9) {
            ForEach(0..<mark.checks, id: \.self) { _ in
                Image(systemName: "checkmark")
            }
        }
        .font(.callout.weight(.semibold))
        .foregroundStyle(mark.tone == .primary ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(mark.accessibilityLabel)
        .accessibilityIdentifier("delivery-mark")
    }
}
