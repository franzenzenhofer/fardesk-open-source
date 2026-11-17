import FardeskStore
import Foundation
import UserNotifications
#if os(iOS)
import UIKit
#endif

/// Push registration follows the login phase: on after login, off and forgotten after logout.
@MainActor
enum PlatformPush {
    static func phaseChanged(to phase: AppModel.Phase) {
        #if os(iOS)
        switch phase {
        case .ready: enable()
        case .loggedOut: disable()
        case .loggingIn, .launching: break
        }
        #endif
    }

    #if os(iOS)
    private static func enable() {
        #if DEBUG
        // Screenshot runs: the system notification prompt would cover every fresh simulator's first screen.
        if UserDefaults.standard.bool(forKey: "FardeskNoPushPrompt") { return }
        #endif
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            guard granted == true else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    private static func disable() {
        UIApplication.shared.unregisterForRemoteNotifications()
        UserDefaults.standard.removeObject(forKey: AppServices.apnsTokenKey)
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }
    #endif
}
