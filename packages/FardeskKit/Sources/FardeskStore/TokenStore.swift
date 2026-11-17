import Foundation

/// Where bearer tokens live, one per machine id. A value built from closures so the app (Keychain)
/// and the CLI (a 0600 file) share every caller. Tokens never go into the machine list.
public struct TokenStore: Sendable {
    public let load: @Sendable (UUID) throws -> String?
    public let save: @Sendable (String, UUID) throws -> Void
    public let delete: @Sendable (UUID) throws -> Void
    public let storedMachineIDs: @Sendable () throws -> [UUID]
    public let deleteAll: @Sendable () throws -> Void

    public init(
        load: @escaping @Sendable (UUID) throws -> String?,
        save: @escaping @Sendable (String, UUID) throws -> Void,
        delete: @escaping @Sendable (UUID) throws -> Void,
        storedMachineIDs: @escaping @Sendable () throws -> [UUID],
        deleteAll: @escaping @Sendable () throws -> Void
    ) {
        self.load = load
        self.save = save
        self.delete = delete
        self.storedMachineIDs = storedMachineIDs
        self.deleteAll = deleteAll
    }

    /// At least one machine has a stored token.
    public func hasAnyToken() throws -> Bool {
        try !storedMachineIDs().isEmpty
    }
}
