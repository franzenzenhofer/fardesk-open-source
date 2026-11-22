import FardeskStore
import SwiftUI

@main
struct FardeskApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    #endif

    init() {
        TapClock.startAtProcessLaunch("launch.list")
    }

    var body: some Scene {
        WindowGroup {
            AppContent(demo: AppServices.shared.demo)
                #if DEBUG
                .overlay(alignment: .topLeading) { TapClockProbe() }
                #endif
                .environment(AppServices.shared.voice)
                .tint(.primary)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        #endif
    }
}

/// The real app, or the demo in its place. Each has its own model and coordinator; the identity of the demo's root changes
/// on every start, so nothing of one run carries into the next.
private struct AppContent: View {
    let demo: DemoMode

    var body: some View {
        Group {
            if let running = demo.running {
                RootView()
                    .environment(running.model)
                    .environment(running.coordinator)
                    .id(running.id)
            } else {
                RootView()
                    .environment(AppServices.shared.model)
                    .environment(AppServices.shared.coordinator)
            }
        }
        .environment(demo)
    }
}
