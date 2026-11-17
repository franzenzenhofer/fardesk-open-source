import SwiftUI

/// Chips for the attached files above the reply field: document icon, file name, remove button.
struct ComposerFileChips: View {
    let files: [ComposerFile]
    let onRemove: (ComposerFile.ID) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row
            ScrollView(.horizontal) { row }.scrollIndicators(.hidden)
        }
    }

    private var row: some View {
        HStack(spacing: 8) {
            ForEach(files) { file in chip(file) }
        }
    }

    private func chip(_ file: ComposerFile) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.fill").foregroundStyle(.secondary)
            Text(file.name).font(.body).lineLimit(1).truncationMode(.middle).frame(maxWidth: 200)
            Button("Remove file", systemImage: "xmark.circle.fill") { onRemove(file.id) }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.secondary.opacity(0.12), in: .capsule)
    }
}
