import Foundation

/// What names this build: the bundle id comes from the build settings (FARDESK_BUNDLE_PREFIX in Config/Local.xcconfig).
/// Nothing else is built in: machines come from pairing, their order from the settings screen.
enum AppIdentity {
    /// Keychain service and log subsystem of this build.
    static let bundleID: String = {
        guard let id = Bundle.main.bundleIdentifier else { preconditionFailure("The app bundle has no bundle identifier") }
        return id
    }()
}
