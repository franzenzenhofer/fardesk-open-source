import FardeskStore
import SwiftUI

/// The first screen of every launch: what the app is doing, never the login screen while the stored login is checked.
struct LaunchView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(model.isHubMode ? "Connecting to the hub (\(model.hubDisplayName))..." : "Starting Fardesk...")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("launch-view")
    }
}
