import Foundation

/// The hub baked into a build (`FARDESK_HUB`): one http(s) address, or empty for no hub.
public enum HubSetting {
    public static func parse(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: trimmed), url.host() != nil, ["http", "https"].contains(url.scheme) else { return nil }
        return url
    }
}
