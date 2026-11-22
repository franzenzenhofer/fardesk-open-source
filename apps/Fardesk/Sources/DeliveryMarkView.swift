import FardeskStore
import SwiftUI

/// One grey check (the computer took it), one blue check (in the session) or two blue checks (Claude read it),
/// right-aligned under the bubble.
struct DeliveryMarkView: View {
    let mark: DeliveryMark

    var body: some View {
        HStack(spacing: -9) {
            ForEach(0..<mark.checks, id: \.self) { _ in
                Image(systemName: "checkmark")
            }
        }
        .font(.callout.weight(.semibold))
        .foregroundStyle(mark.tone == .blue ? AnyShapeStyle(Color.blue) : AnyShapeStyle(.secondary))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(mark.accessibilityLabel)
        .accessibilityIdentifier("delivery-mark")
    }
}
