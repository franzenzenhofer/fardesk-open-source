import FardeskModels
import Foundation

public enum OutputFormat: Sendable, Equatable {
    case human
    case json
}

public struct RenderOptions: Sendable, Equatable {
    public let now: Date
    public let format: OutputFormat
    public let timeZone: TimeZone

    public init(now: Date, format: OutputFormat, timeZone: TimeZone = .current) {
        self.now = now
        self.format = format
        self.timeZone = timeZone
    }
}

/// Compact JSON with the contract encoder, so scripts can consume exactly what the daemon sends.
enum JSONOutput {
    static func compact<Value: Encodable>(_ value: Value) throws -> String {
        String(decoding: try FardeskJSON.makeEncoder().encode(value), as: UTF8.self)
    }
}

/// Plain-text helpers: aligned columns, no colours, no trailing spaces.
enum TextTable {
    static let columnGap = "  "

    static func widths(of rows: [[String]]) -> [Int] {
        guard let columns = rows.first?.count else { return [] }
        return (0..<columns).map { column in rows.reduce(0) { max($0, $1[column].count) } }
    }

    static func format(_ row: [String], widths: [Int]) -> String {
        let cells = row.enumerated().map { column, cell in
            cell.padding(toLength: max(widths[column], cell.count), withPad: " ", startingAt: 0)
        }
        return rstrip(cells.joined(separator: columnGap))
    }

    static func rstrip(_ line: String) -> String {
        String(line.reversed().drop { $0 == " " }.reversed())
    }

    static func render(header: [String], rows: [[String]]) -> [String] {
        let all = [header] + rows
        let widths = widths(of: all)
        return all.map { format($0, widths: widths) }
    }

    static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
