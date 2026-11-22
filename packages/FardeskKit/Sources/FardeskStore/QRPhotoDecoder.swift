import CoreGraphics
import Foundation
import ImageIO
import Vision

/// Reads the QR code out of a photo: the fallback inside the iPhone scanner (the camera button) for a code the live
/// scanner did not pick up. Pure: an image goes in, the text of the first QR code in it (or nil) comes out. What it
/// returns goes through the same path as a live-detected code, `AppModel.pair(link:)`.
public enum QRPhotoDecoder {
    public static func text(in image: CGImage, orientation: CGImagePropertyOrientation = .up) -> String? {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        guard (try? VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])) != nil else { return nil }
        return (request.results ?? []).lazy.compactMap(\.payloadStringValue).first
    }
}
