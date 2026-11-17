import Foundation
import Synchronization

/// The last synchronous section the main thread entered. When the watchdog finds the main thread blocked, this
/// names where it was.
public enum Breadcrumbs {
    private static let last = Mutex("idle")

    public static func mark(_ name: String) {
        last.withLock { $0 = name }
    }

    public static var current: String { last.withLock { $0 } }

    /// Runs a synchronous section under a breadcrumb.
    public static func around<Result>(_ name: String, _ work: () throws -> Result) rethrows -> Result {
        mark(name)
        defer { mark("idle") }
        return try work()
    }
}

/// How long the main thread was blocked and where, as one line of `hangs.jsonl`.
public struct HangRecord: Codable, Equatable, Sendable {
    public let at: Date
    public let seconds: Double
    public let breadcrumb: String

    public init(at: Date, seconds: Double, breadcrumb: String) {
        self.at = at
        self.seconds = seconds
        self.breadcrumb = breadcrumb
    }
}

/// When a blocked main thread is written down: after 1, 2, 10 and 30 seconds, each once per hang.
public enum HangThresholds {
    public static let seconds: [Double] = [1, 2, 10, 30]

    /// The threshold newly crossed at `elapsed`, given the highest one already written for this hang (0 = none).
    public static func newlyCrossed(elapsed: Double, alreadyWritten: Double) -> Double? {
        seconds.last { $0 <= elapsed && $0 > alreadyWritten }
    }
}

/// `hangs.jsonl`: written by the watchdog thread while the app runs, read once at the next launch.
public struct HangLog: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// Appends one record. Plain file IO on the watchdog thread, never the main thread.
    public func append(_ record: HangRecord) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var line = try encoder.encode(record)
        line.append(0x0A)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
        } else {
            try line.write(to: url)
        }
    }

    /// Everything written so far; the file is emptied so each hang is reported once.
    public func takeAll() -> [HangRecord] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        try? FileManager.default.removeItem(at: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return data.split(separator: 0x0A).compactMap { try? decoder.decode(HangRecord.self, from: Data($0)) }
    }
}
