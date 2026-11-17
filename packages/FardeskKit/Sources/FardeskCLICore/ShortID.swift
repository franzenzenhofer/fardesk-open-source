import FardeskModels
import FardeskStore
import Foundation

public enum ShortIDError: Error, Equatable, Sendable, LocalizedError {
    case notFound(query: String)
    case ambiguous(query: String, candidates: [String])

    public var errorDescription: String? {
        switch self {
        case .notFound(let query):
            "No session matches \"\(query)\""
        case .ambiguous(let query, let candidates):
            "\"\(query)\" matches several sessions: \(candidates.joined(separator: ", "))"
        }
    }
}

public enum ShortID {
    public static let length = 8

    public typealias Entry = (machine: String, session: SessionSummary)

    public static func short(_ id: String) -> String {
        String(id.prefix(length))
    }

    /// Unique id prefix first, then an exact (case-insensitive) title.
    public static func resolve(_ query: String, in sessions: [Entry]) throws -> Entry {
        let byID = UniquePrefix.resolve(query, in: sessions) { $0.session.id }
        if case .unique(let entry) = byID { return entry }
        let titles = sessions.filter { $0.session.title.lowercased() == query.lowercased() }
        if titles.count == 1 { return titles[0] }
        if case .ambiguous(let matches) = byID { throw ambiguous(query, matches) }
        if titles.count > 1 { throw ambiguous(query, titles) }
        throw ShortIDError.notFound(query: query)
    }

    private static func ambiguous(_ query: String, _ entries: [Entry]) -> ShortIDError {
        let labels = entries.map { "\($0.machine)/\(short($0.session.id)) \($0.session.title)" }
        return .ambiguous(query: query, candidates: labels)
    }
}
