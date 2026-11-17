import Foundation
import Security

public enum TokenStoreError: Error, Equatable, Sendable, LocalizedError {
    case keychain(status: Int32)
    case corruptTokenFile(path: String)

    public var errorDescription: String? {
        switch self {
        case .keychain(let status):
            let text = SecCopyErrorMessageString(status, nil) as String? ?? "unknown error"
            return "Keychain error \(status): \(text)"
        case .corruptTokenFile(let path):
            return "The token file \(path) is not valid JSON"
        }
    }
}

extension TokenStore {
    /// Generic passwords in the keychain, one item per machine id under `service`, readable after
    /// the first unlock and never synced or backed up off the device.
    ///
    /// macOS uses the file-based login keychain: the data-protection keychain needs a signed
    /// entitlement and fails with -34018 in an unsigned `swift test` binary. iOS only has the
    /// data-protection keychain, which the same query addresses.
    public static func keychain(service: String) -> TokenStore {
        let keychain = Keychain(service: service)
        return TokenStore(
            load: { try keychain.read(account: $0.uuidString) },
            save: { try keychain.write($0, account: $1.uuidString) },
            delete: { try keychain.remove(account: $0.uuidString) },
            storedMachineIDs: { try keychain.accounts().compactMap(UUID.init(uuidString:)) },
            deleteAll: { try keychain.removeAll() }
        )
    }
}

private struct Keychain: Sendable {
    let service: String

    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    }

    func read(account: String) throws -> String? {
        var query = base
        query[kSecAttrAccount as String] = account
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        return (result as? Data).map { String(decoding: $0, as: UTF8.self) }
    }

    func write(_ token: String, account: String) throws {
        try remove(account: account)
        var item = base
        item[kSecAttrAccount as String] = account
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        try check(SecItemAdd(item as CFDictionary, nil))
    }

    func remove(account: String) throws {
        var query = base
        query[kSecAttrAccount as String] = account
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }

    func removeAll() throws {
        let status = SecItemDelete(base as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }

    func accounts() throws -> [String] {
        var query = base
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        try check(status)
        let items = result as? [[String: Any]] ?? []
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }

    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else { throw TokenStoreError.keychain(status: status) }
    }
}
