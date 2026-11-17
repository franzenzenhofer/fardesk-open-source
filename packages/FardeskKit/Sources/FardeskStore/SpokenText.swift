import Foundation

/// Turns assistant markdown into plain words a speech synthesizer can read: no code blocks, no tables,
/// no emphasis marks, links reduced to their text.
public enum SpokenText {
    public static func from(markdown: String) -> String {
        var kept: [String] = []
        var inCodeBlock = false
        for line in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                inCodeBlock.toggle()
                continue
            }
            if inCodeBlock || MarkdownBlocks.isTableLine(line) { continue }
            kept.append(plain(trimmed))
        }
        return collapseBlankLines(kept).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func plain(_ line: String) -> String {
        var text = line
        text.replace(/!?\[([^\]]*)\]\([^)]*\)/) { String($0.1) }
        text.replace(/^(#{1,6}|>+|[-*+]|\d+\.)\s+/, with: "")
        text.replace(/https?:\/\/\S+/, with: "")
        text.replace(/[*_`~]+/, with: "")
        return text.trimmingCharacters(in: .whitespaces)
    }

    private static func collapseBlankLines(_ lines: [String]) -> String {
        var result: [String] = []
        for line in lines where !(line.isEmpty && result.last?.isEmpty != false) {
            result.append(line)
        }
        return result.joined(separator: "\n")
    }
}
