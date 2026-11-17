import FardeskStore
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Turns picked or pasted image bytes into a `ComposerImage`: downscaled to 2048 px on the longest side
/// (never upscaled), upright, JPEG 0.85, or PNG when the source was a PNG screenshot.
enum ComposerImageLoader {
    static func make(from source: Data) -> ComposerImage? {
        guard let reader = CGImageSourceCreateWithData(source as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(reader, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return nil }
        let fitted = ComposerImageSizing.fittedSize(width: width, height: height)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(fitted.width, fitted.height),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(reader, 0, options as CFDictionary) else { return nil }
        let sourceType = CGImageSourceGetType(reader) as String?
        let type: UTType = ComposerImageSizing.keepsPNG(sourceTypeIdentifier: sourceType) ? .png : .jpeg
        guard let data = encode(image, as: type) else { return nil }
        return ComposerImage(data: data, type: type, preview: image)
    }

    private static func encode(_ image: CGImage, as type: UTType) -> Data? {
        let output = NSMutableData()
        guard let writer = CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil) else {
            return nil
        }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: ComposerImageSizing.jpegQuality]
        CGImageDestinationAddImage(writer, image, options as CFDictionary)
        return CGImageDestinationFinalize(writer) ? output as Data : nil
    }
}
