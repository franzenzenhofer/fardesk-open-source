#if os(iOS)
import FardeskStore
import UIKit
import UserNotifications

/// Receives the APNs token, silent pushes and notification actions.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(PushCategories.all)
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            UserDefaults.standard.set(hex, forKey: AppServices.apnsTokenKey)
            await AppServices.shared.registerStoredToken()
        }
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        await Self.record("received silently", type: Self.type(userInfo))
        let info = Self.strings(userInfo)
        guard let action = PushAction.parse(actionIdentifier: "", userInfo: info, text: nil), action == .wipe else {
            return .noData
        }
        await MainActor.run { AppServices.shared.model.wipe() }
        return .newData
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await Self.record("received in the app", type: Self.type(notification.request.content.userInfo))
        // The open app already shows every change live; a banner would only cover the
        // toolbar (Settings, back) and swallow the tap meant for it.
        return [.list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        await Self.record("opened", type: Self.type(response.notification.request.content.userInfo))
        let info = Self.strings(response.notification.request.content.userInfo)
        let text = (response as? UNTextInputNotificationResponse)?.userText
        guard let action = PushAction.parse(actionIdentifier: response.actionIdentifier, userInfo: info, text: text)
        else { return }
        await Self.perform(action)
    }

    private nonisolated static func type(_ userInfo: [AnyHashable: Any]) -> String {
        userInfo["type"] as? String ?? "unknown type"
    }

    private nonisolated static func record(_ what: String, type: String) async {
        await MainActor.run { AppServices.shared.model.recordEvent("push", "\(what): \(type)") }
    }

    @MainActor
    private static func perform(_ action: PushAction) async {
        let services = AppServices.shared
        if services.model.phase != .ready { await services.model.start() }
        if let ref = await services.model.handle(action), isOpening(action) {
            services.coordinator.selection = ref
        }
    }

    private static func isOpening(_ action: PushAction) -> Bool {
        if case .open = action { return true }
        return false
    }

    private nonisolated static func strings(_ userInfo: [AnyHashable: Any]) -> [String: String] {
        userInfo.reduce(into: [:]) { result, pair in
            if let key = pair.key as? String, let value = pair.value as? String { result[key] = value }
        }
    }
}
#endif
