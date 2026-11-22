import SwiftUI

/// App symbol, name and one line under it: the top of the login and the onboarding screens.
struct BrandHeader: View {
    let subtitle: String?

    var body: some View {
        VStack(spacing: 12) {
            Image("AppLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("Fardesk").font(.largeTitle.bold())
            if let subtitle {
                Text(subtitle)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }
}
