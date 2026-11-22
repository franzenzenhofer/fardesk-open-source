/// Things the app offers that need a real machine or a real device. In the demo they stay on screen but are disabled
/// (the standard greyed-out look), so nothing looks usable that does nothing. This list is the one place that decides.
public enum AppFeature: CaseIterable, Sendable {
    /// The Coordinator needs a hub of several machines; the demo machines refuse it (501).
    case coordinator
    /// Pinning a Live Activity would show a pretend session on the lock screen that no push ever updates.
    case liveActivityPin
    /// Notification switches re-register this device with a machine; the demo has no machine to tell.
    case notificationSettings
    /// Adding or removing a machine pairs with or forgets a real computer.
    case addMachine
    /// Logging out signs the device out of real machines.
    case logOut
    /// The device list is read from, and revoked on, real machines.
    case devices
    /// Acting on a session (Fix it, Clear, End, Pin, swipes, Resume ...): the demo shows sessions, it does not run them.
    case sessionActions
    /// Typing and sending into a chat: the demo never talks to an AI.
    case composer
    /// Starting a new session needs a real computer.
    case newSession
    /// Updating machines fetches a package from one real computer and installs it on others.
    case machineUpdate
}

extension AppFeature {
    /// What does nothing in the demo: everything that would act on a real computer, so all of it (owner, 2026-11-22).
    static let unavailableInDemo: Set<AppFeature> = Set(AppFeature.allCases)
}

extension AppModel {
    /// Whether `feature` works right now: always on a real model, only the demo-safe ones in the demo.
    public func isAvailable(_ feature: AppFeature) -> Bool {
        !(isDemo && AppFeature.unavailableInDemo.contains(feature))
    }
}
