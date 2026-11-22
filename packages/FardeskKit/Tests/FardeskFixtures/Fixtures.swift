import FardeskModels
import FardeskStore
import Foundation

/// Loads the daemon's golden contract fixtures for tests (shared by every test target).
public enum Fixtures {
    /// Repo root, found from this file: packages/FardeskKit/Tests/FardeskFixtures/<file>.
    public static let directory: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url.appending(path: "daemon/fardeskd/schema/fixtures", directoryHint: .isDirectory)
    }()

    public static func data(_ contract: String, _ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: "\(contract)/\(name).json"))
    }

    public static func decode<T: Decodable>(_ type: T.Type, _ contract: String, _ name: String) throws -> T {
        try FardeskJSON.makeDecoder().decode(type, from: data(contract, name))
    }

    /// Decodes a fixture after replacing top-level keys (used to build variants of one fixture).
    public static func decode<T: Decodable>(
        _ type: T.Type,
        _ contract: String,
        _ name: String,
        overriding overrides: [String: any Sendable]
    ) throws -> T {
        let object = try JSONSerialization.jsonObject(with: data(contract, name))
        guard var dictionary = object as? [String: Any] else { throw FixtureError.unexpectedShape }
        for (key, value) in overrides { dictionary[key] = value }
        let patched = try JSONSerialization.data(withJSONObject: dictionary)
        return try FardeskJSON.makeDecoder().decode(type, from: patched)
    }

    public static func page(_ name: String) throws -> ActivityPage {
        try decode(ActivityPage.self, "ActivityPage", name)
    }

    /// Builds a page from activities, the way the daemon would send it.
    public static func page(items: [Activity], nextBefore: String?) throws -> ActivityPage {
        let encoded = try JSONSerialization.jsonObject(with: FardeskJSON.makeEncoder().encode(items))
        let wire: [String: Any] = ["items": encoded, "nextBefore": nextBefore ?? NSNull()]
        let data = try JSONSerialization.data(withJSONObject: wire)
        return try FardeskJSON.makeDecoder().decode(ActivityPage.self, from: data)
    }

    public static func activities(_ name: String = "everyActivityKind") throws -> [Activity] {
        try page(name).items
    }

    public static func activity(_ name: String) throws -> Activity {
        try decode(Activity.self, "Activity", name)
    }

    public static func session(_ name: String, overriding overrides: [String: any Sendable] = [:]) throws -> SessionSummary {
        try decode(SessionSummary.self, "SessionSummary", name, overriding: overrides)
    }

    public static func machine(_ name: String = "macosWithClaude", overriding overrides: [String: any Sendable] = [:]) throws -> Machine {
        try decode(Machine.self, "Machine", name, overriding: overrides)
    }


    public static func endpoint(_ name: String, host: String = "100.64.0.10") -> MachineEndpoint {
        MachineEndpoint(
            id: UUID(),
            name: name,
            url: URL(string: "http://\(host):7878")!
        )
    }

    public static func event(_ name: String) throws -> StreamEvent {
        try decode(StreamEvent.self, "StreamEvent", name)
    }
}

enum FixtureError: Error {
    case unexpectedShape
}

extension Fixtures {
    /// A user row with the given words, id and time (the way the daemon sends one).
    public static func userRow(_ text: String, id: String, at date: Date) throws -> Activity {
        try decode(
            Activity.self, "Activity", "user",
            overriding: ["id": id, "text": text, "ts": Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)]
        )
    }
}
