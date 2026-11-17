import FardeskStore
import Foundation

/// What names this build: the bundle id comes from the build settings (FARDESK_BUNDLE_PREFIX in Config/Local.xcconfig).
enum AppIdentity {
    /// Keychain service and log subsystem of this build.
    static let bundleID: String = {
        guard let id = Bundle.main.bundleIdentifier else { preconditionFailure("The app bundle has no bundle identifier") }
        return id
    }()

    /// The machine order the owner configured (FARDESK_MACHINE_ORDER, names separated by ";"). Empty = by name.
    static var machineOrder: [String] {
        MachineOrdering.parse(Bundle.main.object(forInfoDictionaryKey: "FardeskMachineOrder") as? String ?? "")
    }
}
