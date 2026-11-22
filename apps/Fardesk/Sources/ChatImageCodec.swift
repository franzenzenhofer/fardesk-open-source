import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Decoding, downscaling and JPEG encoding of a chat's own image. Pure functions with no UI types, so they run
/// on any thread; callers keep them off the main thread.
enum ChatImageCodec {
    /// What the daemon gets: the long side at most this many pixels.
    static let uploadLongSide = 512
    static let uploadQuality = 0.8
    /// What the list shows and the disk cache keeps: a square of this many pixels.
    static let cacheSide = 192
    static let cacheQuality = 0.8

    /// The picked or photographed image as a JPEG for upload: long side at most 512 px, quality 0.8.
    static func uploadJPEG(from data: Data) -> Data? {
        guard let image = downscaled(from: data, longSide: uploadLongSide) else { return nil }
        return jpeg(image, quality: uploadQuality)
    }

    /// The centre square of the image at `cacheSide` px, ready to draw in the list.
    static func square(from data: Data) -> CGImage? {
        guard let image = downscaled(from: data, longSide: cacheSide * 2) else { return nil }
        return square(image, side: cacheSide)
    }

    static func downscaled(from data: Data, longSide: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: longSide,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }

    private static func square(_ image: CGImage, side: Int) -> CGImage? {
        guard let context = CGContext(
            data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        let scale = CGFloat(side) / CGFloat(min(image.width, image.height))
        let width = CGFloat(image.width) * scale
        let height = CGFloat(image.height) * scale
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: (CGFloat(side) - width) / 2, y: (CGFloat(side) - height) / 2, width: width, height: height))
        return context.makeImage()
    }
}
