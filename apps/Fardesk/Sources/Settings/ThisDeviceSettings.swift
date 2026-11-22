import FardeskStore
import SwiftUI
import UserNotifications

/// Settings > This device: how this device is called on the machines, and whether notifications can reach it.
struct ThisDeviceSettings: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var registration: Registration?

    /// Where notifications stand on this device, in words a non-specialist can act on.
    enum Registration: Equatable {
        case on
        case waiting
        case blocked
        case notAsked

        var text: String {
            switch self {
            case .on: "On"
            case .waiting: "Waiting for Apple"
            case .blocked: "Off in System Settings"
            case .notAsked: "Not asked yet"
            }
        }

        var explanation: String {
            switch self {
            case .on: "Notifications can reach this device."
            case .waiting: "Allowed. Apple has not given this device its address yet; this usually takes a moment."
            case .blocked: "Fardesk is not allowed to send notifications. Turn them on in System Settings."
            case .notAsked: "Fardesk has not asked for permission yet. It asks when you first pair a machine."
            }
        }

        static func from(_ status: UNAuthorizationStatus, hasToken: Bool) -> Registration {
            switch status {
            case .denied: .blocked
            case .notDetermined: .notAsked
            default: hasToken ? .on : .waiting
            }
        }
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Name", value: model.deviceName)
                LabeledContent("Notifications", value: registration?.text ?? "Checking...")
            } footer: {
                SettingsFooter(registration?.explanation ?? "The name is how your machines list this device.")
            }
            if registration == .blocked, let url = Self.systemSettingsURL {
                Section { Button("Open System Settings") { openURL(url) } }
            }
        }
        .navigationTitle("This device")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            registration = .from(status, hasToken: AppServices.shared.apnsToken != nil)
        }
    }

    private static var systemSettingsURL: URL? {
        #if os(iOS)
        URL(string: UIApplication.openSettingsURLString)
        #else
        URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        #endif
    }
}
