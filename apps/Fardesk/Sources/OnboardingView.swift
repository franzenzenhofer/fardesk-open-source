import FardeskStore
import SwiftUI

/// The first screen of a clean install: nothing is paired, so there is nothing to log in to. Pairing is the only way
/// in (no password, no address field), and it needs Tailscale: on the iPhone and iPad the scanner for the QR code that
/// `fardeskd pair` shows, on the Mac (no camera) the pasted link. Or look around in the demo (no machine needed).
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(DemoMode.self) private var demo
    @State private var showsPairing = false

    private var isPairing: Bool { model.phase == .loggingIn }

    var body: some View {
        #if os(iOS)
        phoneBody
        #else
        macBody
        #endif
    }

    #if os(iOS)
    /// Everything on one screen, no scrolling at the default text size: the scanner takes the space that is left. At
    /// large text sizes the same content scrolls.
    private var phoneBody: some View {
        ViewThatFits(in: .vertical) {
            phoneContent
            ScrollView { phoneContent.frame(minHeight: 560) }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("onboarding")
    }

    private var phoneContent: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image("AppLogo").resizable().scaledToFit().frame(width: 44, height: 44).accessibilityHidden(true)
                Text("Fardesk").font(.title.bold())
            }
            if let error = model.loginError {
                Text(error).font(.body).foregroundStyle(StateColor.broken).multilineTextAlignment(.center)
            }
            ScanPairingPanel()
            demoButton
        }
    }
    #endif

    #if os(macOS)
    private var macBody: some View {
        VStack(spacing: 24) {
            Spacer()
            BrandHeader(subtitle: "Your Claude sessions on your own machines, in one list. Pair a machine to start.")
            VStack(spacing: 12) {
                if let error = model.loginError {
                    Text(error).font(.body).foregroundStyle(StateColor.broken).multilineTextAlignment(.center)
                }
                TailscaleGate {
                    VStack(spacing: 12) {
                        Button { showsPairing = true } label: {
                            HStack {
                                if isPairing { ProgressView() }
                                Text("Pair with a link")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.fardeskPrimary)
                        .disabled(isPairing)
                        .accessibilityIdentifier("onboarding-pair")
                        Text(prompt)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                demoButton
                if let failure = demo.failure {
                    Text(failure).font(.body).foregroundStyle(StateColor.broken).multilineTextAlignment(.center)
                }
                Text("No computer needed: sample sessions on pretend machines, nothing leaves this device.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("onboarding")
        .sheet(isPresented: $showsPairing) { PairingSheet() }
    }

    private var prompt: String {
        if model.isHubMode { return "Run `fardeskd pair` on the hub (\(model.hubDisplayName), \(model.hubAddress)) and paste its link." }
        return "Run `fardeskd pair` on your computer within 2 minutes and paste its link. Both devices need Tailscale."
    }
    #endif

    private var demoButton: some View {
        Button { demo.enter() } label: {
            Text("See a demo").frame(maxWidth: .infinity)
        }
        .buttonStyle(.fardeskSecondary)
        .accessibilityIdentifier("onboarding-demo")
        #if DEBUG
        // Launch argument -FardeskDemo YES: straight into the demo, for screenshots without clicking (with -FardeskOpenSession).
        .task { if UserDefaults.standard.bool(forKey: "FardeskDemo") { demo.enter() } }
        #endif
    }
}
