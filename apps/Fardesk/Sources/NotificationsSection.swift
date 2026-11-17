import FardeskModels
import FardeskStore
import SwiftUI

/// One toggle per notification type; every change re-registers this device.
struct NotificationsSection: View {
    var body: some View {
        Section("Notifications") {
            ForEach(NotificationPreferences.allTypes, id: \.self) { NotificationToggle(type: $0) }
        }
    }
}

private struct NotificationToggle: View {
    let type: NotificationType
    @AppStorage private var isOn: Bool

    init(type: NotificationType) {
        self.type = type
        _isOn = AppStorage(wrappedValue: true, NotificationPreferences.key(for: type))
    }

    var body: some View {
        Toggle(NotificationPreferences.label(for: type), isOn: $isOn)
            .onChange(of: isOn) { Task { await AppServices.shared.registerStoredToken() } }
    }
}
