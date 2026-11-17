import FardeskStore
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// The first row of the machine list when no machine answers: says why, and (when Tailscale is
/// off and its app is installed) opens Tailscale.
struct ConnectivityBannerView: View {
    let banner: ConnectivityBanner
    @Environment(\.openURL) private var openURL

    private static let tailscaleURL = URL(string: "tailscale://")!

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(banner.text, systemImage: "exclamationmark.triangle")
            if banner.opensTailscale, Self.tailscaleIsInstalled {
                Button("Open Tailscale") { openURL(Self.tailscaleURL) }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private static var tailscaleIsInstalled: Bool {
        #if canImport(UIKit)
        UIApplication.shared.canOpenURL(tailscaleURL)
        #else
        NSWorkspace.shared.urlForApplication(toOpen: tailscaleURL) != nil
        #endif
    }
}
