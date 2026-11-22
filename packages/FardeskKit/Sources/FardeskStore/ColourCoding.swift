import Foundation

/// The Settings switch "Automatic colours": every session shows the colour the daemon gave it (`autoColor`),
/// unless the user picked one. Off by default (owner, 2026-11-22: colouring every row made them all look active), kept in `UserDefaults` like the notification switches.
public struct ColourCoding: Sendable {
    public static let key = "colourCoding.automatic"
    public static let defaultValue = false

    nonisolated(unsafe) private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isAutomatic: Bool {
        get { defaults.object(forKey: Self.key) as? Bool ?? Self.defaultValue }
        nonmutating set { defaults.set(newValue, forKey: Self.key) }
    }
}
