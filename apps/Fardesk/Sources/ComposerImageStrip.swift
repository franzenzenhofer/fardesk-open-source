import SwiftUI

/// Thumbnails of the attached pictures above the reply field, each with a remove button. A few fit
/// in a plain row; more scroll sideways.
struct ComposerImageStrip: View {
    let images: [ComposerImage]
    let onRemove: (ComposerImage.ID) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row
            ScrollView(.horizontal) { row }.scrollIndicators(.hidden)
        }
    }

    private var row: some View {
        HStack(spacing: 12) {
            ForEach(images) { image in thumbnail(image) }
        }
    }

    private func thumbnail(_ image: ComposerImage) -> some View {
        Image(decorative: image.preview, scale: 1)
            .resizable()
            .scaledToFill()
            .frame(width: 72, height: 72)
            .clipShape(.rect(cornerRadius: 12))
            .overlay(alignment: .topTrailing) {
                Button("Remove picture", systemImage: "xmark.circle.fill") { onRemove(image.id) }
                    .labelStyle(.iconOnly)
                    .font(.title3)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.65))
                    .buttonStyle(.plain)
                    .offset(x: 6, y: -6)
            }
            .padding(.top, 6)
            .padding(.trailing, 6)
    }
}
