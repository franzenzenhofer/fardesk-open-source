import FardeskDemo
import FardeskStore
import Observation
import SwiftUI

/// Demo mode: the app shows pretend machines and sessions (`FardeskDemo`), in a model and a coordinator of their own.
/// The real model stays exactly as it was, so leaving the demo returns to what the app showed before (the onboarding on a
/// clean install). Nothing in the demo is saved, sent or connected.
@MainActor
@Observable
final class DemoMode {
    @MainActor
    struct Running: Identifiable {
        let id = UUID()
        let model: AppModel
        let coordinator = SessionCoordinator()
    }

    private(set) var running: Running?
    private(set) var failure: String?

    func enter() {
        guard running == nil else { return }
        do {
            let model = AppModel.makeDemo(world: try DemoWorld())
            running = Running(model: model)
            failure = nil
            Task { await model.start() }
        } catch {
            failure = error.localizedDescription
        }
    }

    func leave() {
        running?.model.endDemo()
        running = nil
    }
}

/// The demo notice is content, never an overlay on the navigation bar or toolbar (ticket #98): the first row of the
/// sessions list, with the way out, and a one-line `DemoNoticeLine` at the top of every other demo screen. Both are
/// plain text in the body font, so they grow with Dynamic Type and wrap instead of covering anything.
struct DemoNoticeRow: View {
    @Environment(DemoMode.self) private var demo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            (Text("Demo ").bold() + Text("Sample data. Nothing leaves this device."))
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("demo-tag")
            Button("Leave demo") { demo.leave() }
                .buttonStyle(.fardeskSecondary)
                .accessibilityIdentifier("demo-leave")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("demo-notice")
    }
}

/// The one line at the top of the content of a demo screen (a session, the new-session form, Settings).
struct DemoNoticeLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.isDemo {
            Text("Demo: sample data, nothing leaves this device.")
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .accessibilityIdentifier("demo-notice-line")
        }
    }
}

/// The one place that greys out what does nothing in the demo: `AppModel.isAvailable` (unit tested) decides.
private struct DemoDisabled: ViewModifier {
    @Environment(AppModel.self) private var model
    let feature: AppFeature

    func body(content: Content) -> some View {
        let available = model.isAvailable(feature)
        // Faded as well as disabled: the app's own button styles do not grey themselves, and the owner wants to see at a
        // glance what the demo cannot do.
        content.disabled(!available).opacity(available ? 1 : 0.4)
    }
}

extension View {
    /// Disabled and faded while the demo runs and `feature` needs a real machine or device.
    func disabledInDemo(_ feature: AppFeature) -> some View { modifier(DemoDisabled(feature: feature)) }
}
