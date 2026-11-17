import FardeskModels

/// `fardesk detail`: a diff with line numbers and signs, or plain output lines.
public enum DetailRenderer {
    public static func render(_ detail: ActivityDetail, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(detail)
        case .human: human(detail)
        }
    }

    private static func human(_ detail: ActivityDetail) -> String {
        var blocks = detail.sections.map { section(detail.kind, $0) }
        if blocks.isEmpty { blocks = ["(no output)"] }
        if detail.truncated { blocks.append("(truncated)") }
        return blocks.joined(separator: "\n\n")
    }

    private static func section(_ kind: DetailKind, _ section: DetailSection) -> String {
        let lines = switch kind {
        case .diff: diffLines(section.lines)
        case .output: section.lines.map { TextTable.rstrip($0.text) }
        }
        return ([header(kind, section)] + lines).joined(separator: "\n")
    }

    private static func header(_ kind: DetailKind, _ section: DetailSection) -> String {
        let subtitle = section.subtitle.isEmpty ? "" : " - \(section.subtitle)"
        let counts = kind == .diff ? "  +\(section.added) -\(section.removed)" : ""
        return "\(section.title)\(subtitle)\(counts)"
    }

    private static func diffLines(_ lines: [DetailLine]) -> [String] {
        let width = lines.compactMap(\.number).reduce(0) { max($0, String($1).count) }
        return lines.map { line in
            let number = line.number.map(String.init) ?? ""
            let padded = String(repeating: " ", count: width - number.count) + number
            return TextTable.rstrip("\(padded) \(line.sign.rawValue) \(line.text)")
        }
    }
}
