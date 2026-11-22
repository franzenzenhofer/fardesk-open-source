import FardeskModels
import Foundation

public enum DemoError: Error, LocalizedError, Equatable {
    case fixtureMissing(String)
    case fixtureInvalid(String)
    case notAvailable(String)

    public var errorDescription: String? {
        switch self {
        case .fixtureMissing(let name): "The demo data \(name) is missing from the app."
        case .fixtureInvalid(let detail): "The demo data is not valid: \(detail)"
        case .notAvailable(let what): "Not available in the demo: \(what)."
        }
    }
}

/// The wire models have no public initialisers (they only come from JSON), so the demo builds and changes them the
/// way a machine would send them: as JSON, decoded with the one decoder the real client uses.
enum DemoJSON {
    private static let timestamp = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    static func iso(_ date: Date) -> String { timestamp.format(date) }

    /// JSON null for a missing value.
    static func orNull(_ value: Any?) -> Any { value ?? NSNull() }

    static func object(_ data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DemoError.fixtureInvalid("the top level is not an object")
        }
        return object
    }

    static func decode<T: Decodable>(_ type: T.Type = T.self, from object: Any) throws -> T {
        let data = try JSONSerialization.data(withJSONObject: object)
        do {
            return try FardeskJSON.makeDecoder().decode(T.self, from: data)
        } catch {
            throw DemoError.fixtureInvalid("\(T.self): \(error)")
        }
    }

    static func dictionary<T: Encodable>(_ value: T) throws -> [String: Any] {
        try object(FardeskJSON.makeEncoder().encode(value))
    }

    /// The value with some keys replaced (`NSNull()` clears one).
    static func patched<T: Codable>(_ value: T, _ changes: [String: Any]) throws -> T {
        var fields = try dictionary(value)
        for (key, change) in changes { fields[key] = change }
        return try decode(T.self, from: fields)
    }
}
