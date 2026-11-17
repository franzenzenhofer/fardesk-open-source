import FardeskModels
import Foundation

/// The machines baked into a build (`FARDESK_BOOTSTRAP_MACHINES`, format `Name|URL;Name|URL`).
public enum BootstrapMachines {
    private static let entrySeparator: Character = ";"
    private static let fieldSeparator: Character = "|"

    /// Entries without a name, without a valid http(s) URL or with extra fields are skipped.
    public static func parse(_ text: String) -> [Peer] {
        text.split(separator: entrySeparator).compactMap { entry in
            let fields = entry.split(separator: fieldSeparator, omittingEmptySubsequences: false)
            guard fields.count == 2 else { return nil }
            let name = fields[0].trimmingCharacters(in: .whitespaces)
            let address = fields[1].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty, let url = URL(string: address), url.host() != nil,
                  ["http", "https"].contains(url.scheme)
            else { return nil }
            return Peer(name: name, url: url)
        }
    }
}
