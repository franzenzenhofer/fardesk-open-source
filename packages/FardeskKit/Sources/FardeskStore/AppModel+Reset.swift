import Foundation

/// Every saved setting of this app on this device: the whole `UserDefaults` domain of the app (notification
/// switches, colours, voice, Face ID, the push token ...). Removing the domain, not a list of keys, means a setting
/// added later is reset too without anyone remembering to add it here.
public struct SavedSettings: Sendable {
    nonisolated(unsafe) private let defaults: UserDefaults
    public let domain: String

    public init(defaults: UserDefaults, domain: String) {
        self.defaults = defaults
        self.domain = domain
    }

    /// The settings of the running app: the standard defaults under the bundle identifier.
    public static func ofThisApp() -> SavedSettings {
        guard let identifier = Bundle.main.bundleIdentifier else {
            fatalError("Fardesk: the app bundle has no identifier, so its saved settings cannot be found")
        }
        return SavedSettings(defaults: .standard, domain: identifier)
    }

    /// The keys that are saved right now.
    public var keys: [String] { (defaults.persistentDomain(forName: domain) ?? [:]).keys.sorted() }

    /// Deletes every saved setting; each one falls back to its default.
    public func removeAll() {
        defaults.removePersistentDomain(forName: domain)
    }
}

extension MachineOrderFile {
    /// Deletes the saved order (a missing file is fine): machines are listed alphabetically again.
    public func remove() throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }
}

extension AppModel {
    /// Factory reset: signs this device out of every machine, then forgets everything local: tokens, machines,
    /// cached chats, the machine order, queued reports and every saved setting. The onboarding comes back.
    /// `apnsToken` is read before the settings go, because logging out unregisters it on the machines.
    public func resetFardesk(apnsToken: String?, settings: SavedSettings) async {
        await logout(apnsToken: apnsToken)
        do {
            try configuration.machineOrderFile?.remove()
        } catch {
            raise("Fardesk: could not delete the saved machine order: \(ErrorText.detail(error))", area: "reset Fardesk", error: error)
        }
        let queued = Set(configuration.telemetry.pending.map(\.id))
        configuration.telemetry.remove(ids: queued)
        settings.removeAll()
        state = AppState()
        coordinatorSessionID = nil
    }

    /// Deletes the chats this device keeps for offline use. They are loaded again from the machines when opened.
    public func clearCachedChats() {
        flushFeeds()
        do {
            try cacheWriter.wipe { try configuration.cache.removeAll() }
        } catch {
            raise("Fardesk: could not clear the cached chats: \(ErrorText.detail(error))", area: "clear the cache", error: error)
        }
        dirtyFeeds = []
    }

    /// The name this device shows on the machines it is registered on.
    public var deviceName: String { configuration.deviceName }
}
