import FardeskStore
import SwiftUI

/// One assistant message, parsed once: prose as attributed text, tables as cells. Parsing markdown is not cheap,
/// so it happens when a text is first drawn and the result is kept per text, never again in a view body.
enum RenderedMarkdown {
    case prose(AttributedString)
    case heading(level: Int, text: AttributedString)
    case table(header: [AttributedString], rows: [[AttributedString]])

    private final class Box {
        let blocks: [RenderedMarkdown]
        init(_ blocks: [RenderedMarkdown]) { self.blocks = blocks }
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 400
        return cache
    }()

    static func blocks(for text: String) -> [RenderedMarkdown] {
        if let known = cache.object(forKey: text as NSString) { return known.blocks }
        let rendered = MarkdownBlocks.split(text).map { block -> RenderedMarkdown in
            switch block {
            case .prose(let prose): .prose(MarkdownText.inline(prose))
            case .heading(let level, let text): .heading(level: level, text: MarkdownText.inline(text))
            case .table(let header, let rows): .table(header: header.map(MarkdownText.inline), rows: rows.map { $0.map(MarkdownText.inline) })
            }
        }
        cache.setObject(Box(rendered), forKey: text as NSString)
        return rendered
    }
}

/// Assistant markdown: inline markdown (bold, italics, code, links) with line breaks kept, and pipe
/// tables as a grid; no third-party package.
struct MarkdownText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(RenderedMarkdown.blocks(for: text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .prose(let prose): Text(prose)
                case .heading(let level, let text): Text(text).font(level <= 1 ? .title3.bold() : .headline).padding(.top, 4)
                case .table(let header, let rows): MarkdownTable(header: header, rows: rows)
                }
            }
        }
        .textSelection(.enabled)
    }

    nonisolated static func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

private struct MarkdownTable: View {
    let header: [AttributedString]
    let rows: [[AttributedString]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                GridRow { cells(header).font(.subheadline.bold()) }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow { cells(row).font(.subheadline) }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func cells(_ values: [AttributedString]) -> some View {
        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
            Text(value)
        }
    }
}
