import Foundation

/// What the composer accepts as a file attachment: any file up to 20 MB, sent with its own media type.
public enum ComposerFileRules {
    /// Same limit as the daemon (`MAX_ATTACHMENT_BYTES`).
    public static let maxBytes = 20_000_000
    public static let fallbackMediaType = "application/octet-stream"
    /// Files and pictures together that one message may carry.
    public static let maxAttachments = 10

    public static func fits(byteCount: Int) -> Bool { byteCount <= maxBytes }

    /// The media type to upload with: the system's preferred type for the file, else a generic binary type.
    public static func mediaType(preferred: String?) -> String {
        guard let preferred, !preferred.trimmingCharacters(in: .whitespaces).isEmpty else { return fallbackMediaType }
        return preferred
    }

    /// The inline error for a file that is too large, e.g. "Report.pdf is 25.3 MB; the limit is 20 MB."
    public static func tooLargeMessage(name: String, byteCount: Int) -> String {
        let megabytes = Double(byteCount) / 1_000_000
        return "\(name) is \(String(format: "%.1f", megabytes)) MB; the limit is \(maxBytes / 1_000_000) MB."
    }

    public static func remainingSlots(images: Int, files: Int) -> Int { max(0, maxAttachments - images - files) }
}
