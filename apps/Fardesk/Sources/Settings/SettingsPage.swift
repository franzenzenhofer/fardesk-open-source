import FardeskStore
import SwiftUI

/// Every screen the Settings list opens. One value per screen keeps the navigation in one place.
enum SettingsPage: Hashable {
    case machines
    case machineOrder
    case machine(UUID)
    case thisDevice
    case notifications
    case appearance
    case hiddenChats
    case voice
    case security
    case data
    case about
}

/// One row of the Settings list: a small black symbol and a plain title, like the iOS Settings app.
struct SettingsRow: View {
    let title: String
    let symbol: String
    var detail: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(.primary)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(title)
            if let detail {
                Spacer()
                Text(detail).foregroundStyle(.secondary)
            }
        }
    }
}

/// A footer under a settings group, at body size: nothing in the app is set smaller than 16 pt.
struct SettingsFooter: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.body)
    }
}

extension SettingsPage {
    @MainActor @ViewBuilder
    func destination() -> some View {
        switch self {
        case .machines: MachinesSettings()
        case .machineOrder: MachineOrderList()
        case .machine(let id): MachineDetailView(machineID: id)
        case .thisDevice: ThisDeviceSettings()
        case .notifications: NotificationsSettings()
        case .appearance: AppearanceSettings()
        case .hiddenChats: HiddenChatsView()
        case .voice: VoiceSettingsView()
        case .security: SecuritySettings()
        case .data: DataSettings()
        case .about: AboutSettings()
        }
    }
}
