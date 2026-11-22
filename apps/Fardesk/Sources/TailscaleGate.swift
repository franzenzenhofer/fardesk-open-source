import FardeskStore
import SwiftUI

/// Tailscale is mandatory: every pairing screen shows its content only while this device is on Tailscale, and otherwise
/// says in plain words what to do. The check is the one `AppModel.pair(link:)` uses (`AppModel.isOnTailscale`); it runs
/// when the screen appears, when the app returns to the foreground and when the person taps "Check again".
struct TailscaleGate<Content: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var isOn: Bool?
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            switch isOn {
            case .some(true): content()
            case .some(false): TailscaleOffNotice(recheck: recheck)
            case .none: Color.clear
            }
        }
        .onAppear(perform: recheck)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { recheck() }
        }
    }

    private func recheck() { isOn = model.isOnTailscale }
}

/// What the screen says while Tailscale is off, with a button that checks again.
struct TailscaleOffNotice: View {
    let recheck: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "network.slash").font(.largeTitle).accessibilityHidden(true)
            Text(TailscaleRequirement.offMessage)
                .font(.body.weight(.semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Check again", action: recheck)
                .buttonStyle(.fardeskPrimary)
                .accessibilityIdentifier("tailscale-recheck")
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.primary, lineWidth: 2))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tailscale-off")
    }
}
