import FardeskStore
import Foundation
import ImageIO
import SwiftUI

/// Where a thumbnail's bytes come from: the machine that stored the file, or the message still on this device.
enum AttachmentImageSource {
    case stored(SessionRef, path: String)
    case local(OutgoingAttachment, key: String)

    var key: String {
        switch self {
        case .stored(let ref, let path): "\(ref.machineID.uuidString)/\(ref.sessionID)\(path)"
        case .local(_, let key): "local/\(key)"
        }
    }

    @MainActor func data(model: AppModel) async throws -> Data {
        switch self {
        case .stored(let ref, let path):
            return try await model.attachmentData(in: ref, path: path)
        case .local(let attachment, _):
            switch attachment.source {
            case .data(let data): return data
            case .file(let url): return try await Task.detached { try Data(contentsOf: url) }.value
            }
        }
    }
}

/// Decoded pictures by source key, so scrolling a long feed never fetches or decodes one twice.
final class AttachmentImageCache: @unchecked Sendable {
    static let shared = AttachmentImageCache()
    /// Longest side of a decoded picture: sharp in the full screen sheet, small enough to keep many.
    static let maxPixelSize = 1600
    private static let bytesPerPixel = 4
    private static let memoryLimit = 96_000_000

    private final class Entry {
        let image: CGImage
        init(_ image: CGImage) { self.image = image }
    }

    private let storage = NSCache<NSString, Entry>()

    private init() {
        storage.totalCostLimit = Self.memoryLimit
    }

    func image(for key: String) -> CGImage? {
        storage.object(forKey: key as NSString)?.image
    }

    func store(_ image: CGImage, for key: String) {
        storage.setObject(Entry(image), forKey: key as NSString, cost: image.width * image.height * Self.bytesPerPixel)
    }

    /// Decodes (and downsizes) on the calling thread: call it from a detached task, never from the main actor.
    static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}

extension EnvironmentValues {
    /// The session whose feed is on screen: thumbnails in its messages fetch their files from its machine.
    @Entry var attachmentSession: SessionRef?
}
