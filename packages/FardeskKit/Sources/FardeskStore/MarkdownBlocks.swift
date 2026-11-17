import Foundation

/// Splits assistant markdown into prose and pipe tables, so tables render as a grid, not raw pipes.
public enum MarkdownBlock: Equatable, Sendable {
    case prose(String)
    case table(header: [String], rows: [[String]])
}

public enum MarkdownBlocks {
    /// Prose keeps its original lines; a table is two or more consecutive `|` lines with a `---` separator.
    public static func split(_ text: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var prose: [Substring] = []
        var table: [Substring] = []
        func flushProse() {
            if !prose.isEmpty { blocks.append(.prose(prose.joined(separator: "\n"))) }
            prose = []
        }
        func flushTable() {
            if let parsed = parseTable(table) {
                flushProse()
                blocks.append(parsed)
            } else {
                prose.append(contentsOf: table)
            }
            table = []
        }
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if isTableLine(line) { table.append(line) } else { flushTable(); prose.append(line) }
        }
        flushTable()
        flushProse()
        return blocks
    }

    static func isTableLine(_ line: Substring) -> Bool {
        line.trimmingCharacters(in: .whitespaces).hasPrefix("|")
    }

    static func cells(_ line: Substring) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    static func isSeparator(_ line: Substring) -> Bool {
        let parts = cells(line)
        return !parts.isEmpty && parts.allSatisfy { cell in
            !cell.isEmpty && cell.allSatisfy { $0 == "-" || $0 == ":" }
        }
    }

    static func parseTable(_ lines: [Substring]) -> MarkdownBlock? {
        guard lines.count >= 2, isSeparator(lines[1]) else { return nil }
        let rows = lines.dropFirst(2).map(cells)
        return .table(header: cells(lines[0]), rows: Array(rows))
    }
}
