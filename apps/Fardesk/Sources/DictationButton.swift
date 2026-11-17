#if os(iOS)
import SwiftUI

/// The mic in the reply field: one tap starts the recording state of the composer.
struct DictationButton: View {
    let action: () -> Void

    var body: some View {
        Button("Dictate", systemImage: "mic", action: action)
            .labelStyle(.iconOnly)
            .font(.title2)
            .foregroundStyle(.secondary)
    }
}
#endif
