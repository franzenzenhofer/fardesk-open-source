#if os(iOS)
import FardeskStore
import UserNotifications

/// The notification categories the daemon names in `aps.category`.
enum PushCategories {
    static var all: Set<UNNotificationCategory> {
        [
            category("PERMISSION", [
                UNNotificationAction(
                    identifier: PushAction.allowIdentifier, title: "Allow", options: [.authenticationRequired]
                ),
                UNNotificationAction(identifier: PushAction.denyIdentifier, title: "Deny", options: [.destructive]),
            ]),
            category("QUESTION", [replyAction]),
            category("DONE", [
                replyAction,
                UNNotificationAction(identifier: PushAction.openIdentifier, title: "Open", options: [.foreground]),
            ]),
            category("ENDED", []),
            category("TERMINAL", []),
        ]
    }

    private static func category(_ identifier: String, _ actions: [UNNotificationAction]) -> UNNotificationCategory {
        UNNotificationCategory(identifier: identifier, actions: actions, intentIdentifiers: [])
    }

    private static var replyAction: UNNotificationAction {
        UNTextInputNotificationAction(
            identifier: PushAction.replyIdentifier,
            title: "Reply",
            options: [.authenticationRequired],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Reply"
        )
    }
}
#endif
