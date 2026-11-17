import SwiftUI

/// Grey placeholder rows for a list that is loading: the shape of the answer, never a blank screen.
struct SkeletonRows: View {
    var count = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(0..<count, id: \.self) { index in
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: 6).frame(width: index.isMultiple(of: 2) ? 220 : 160, height: 16)
                    RoundedRectangle(cornerRadius: 6).frame(height: 16)
                }
            }
        }
        .foregroundStyle(.secondary.opacity(0.18))
        .padding()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
        .accessibilityIdentifier("skeleton-rows")
    }
}
