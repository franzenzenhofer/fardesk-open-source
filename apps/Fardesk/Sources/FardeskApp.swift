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
            RootView()
                #if DEBUG
                .overlay(alignment: .topLeading) { TapClockProbe() }
                #endif
                .environment(AppServices.shared.model)
                .environment(AppServices.shared.coordinator)
                .environment(AppServices.shared.voice)
                .tint(.primary)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        #endif
    }
}
