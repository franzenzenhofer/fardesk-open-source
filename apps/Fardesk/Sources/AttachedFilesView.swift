import FardeskStore
import SwiftUI

/// The files of a user message below its words: pictures as thumbnails, audio and other files as small labelled chips.
struct AttachedFilesView: View {
    @Environment(\.attachmentSession) private var session
    let files: [AttachedFile]

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(files) { file in
                if file.kind == .image, let session {
                    AttachmentThumbnail(source: .stored(session, path: file.path), name: file.displayName)
                } else {
                    AttachmentChip(name: file.displayName, symbolName: Self.symbol(file.kind))
                }
            }
        }
    }

    private static func symbol(_ kind: AttachedFile.Kind) -> String {
        switch kind {
        case .image: "photo"
        case .audio: "waveform"
        case .file: "doc"
        }
    }
}

/// A small pill with a symbol and a file name.
struct AttachmentChip: View {
    let name: String
    let symbolName: String

    var body: some View {
        Label(name, systemImage: symbolName)
            .font(.subheadline)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.secondary.opacity(0.12), in: .capsule)
            .accessibilityIdentifier("attachment-chip")
    }
}

/// The attachments of a message still on its way: the local picture, or a chip for sound and files.
struct PendingAttachmentsView: View {
    let message: PendingMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(Array(message.message.attachments.enumerated()), id: \.offset) { index, attachment in
                if attachment.mediaType.hasPrefix("image/") {
                    AttachmentThumbnail(source: .local(attachment, key: "\(message.id.uuidString)/\(index)"), name: attachment.filename)
                } else {
                    AttachmentChip(name: attachment.filename, symbolName: attachment.mediaType.hasPrefix("audio/") ? "waveform" : "doc")
                }
            }
        }
    }
}
