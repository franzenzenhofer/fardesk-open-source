import CoreGraphics
import FardeskStore
import Foundation
import UniformTypeIdentifiers

/// One picture attached in the composer, already downscaled and encoded for sending.
struct ComposerImage: Identifiable, Sendable {
    let id = UUID()
    /// JPEG (quality 0.85) or PNG bytes, longest side at most 2048 pixels.
    let data: Data
    /// `.jpeg` or `.png`.
    let type: UTType
    /// The same pixels decoded once, for the thumbnail.
    let preview: CGImage

    var fileExtension: String { type.preferredFilenameExtension ?? "jpg" }
}

/// One file of any kind attached in the composer, read into memory (at most 20 MB).
struct ComposerFile: Identifiable, Sendable {
    let id = UUID()
    let data: Data
    let name: String
    /// The system's preferred media type for the file, or `application/octet-stream`.
    let mediaType: String
}

/// What the composer hands to its `send` closure: the typed or dictated text, the voice recording
/// when "Attach voice recording" is on, the attached pictures and the attached files.
struct ComposerMessage: Sendable {
    var text: String
    /// AAC .m4a in the temporary directory; nil when no recording was made or attached.
    var audio: URL?
    var images: [ComposerImage]
    var files: [ComposerFile]

    init(text: String, audio: URL? = nil, images: [ComposerImage] = [], files: [ComposerFile] = []) {
        self.text = text
        self.audio = audio
        self.images = images
        self.files = files
    }
}

extension ComposerMessage {
    /// The text with its pictures (JPEG or PNG), files and the voice recording (m4a), when present.
    var outgoing: OutgoingMessage {
        var attachments = images.enumerated().map { index, image in
            OutgoingAttachment(
                source: .data(image.data),
                mediaType: image.type.preferredMIMEType ?? "image/jpeg",
                filename: "picture-\(index + 1).\(image.fileExtension)"
            )
        }
        attachments += files.map {
            OutgoingAttachment(source: .data($0.data), mediaType: $0.mediaType, filename: $0.name)
        }
        if let audio {
            attachments.append(
                OutgoingAttachment(source: .file(audio), mediaType: "audio/m4a", filename: audio.lastPathComponent)
            )
        }
        return OutgoingMessage(text: text, attachments: attachments)
    }
}

extension AppModel {
    /// Uploads the pictures and the recording to the session's machine, then sends the text with them.
    @discardableResult
    func send(_ message: ComposerMessage, to ref: SessionRef) async -> Bool {
        await send(message.outgoing, to: ref)
    }
}
