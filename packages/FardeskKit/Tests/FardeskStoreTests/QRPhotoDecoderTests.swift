import CoreImage
import FardeskStore
import Foundation
import Testing

/// The camera button of the scanner: a photo goes through `QRPhotoDecoder`; a found code then takes the same path as a
/// live-detected one (`AppModel.pair(link:)`, covered by ScannedLinkTests).
struct QRPhotoDecoderTests {
    private func photo(_ image: CIImage) throws -> CGImage {
        try #require(CIContext().createCGImage(image, from: image.extent))
    }

    @Test func aPhotoOfACodeReadsBackAsTheSameText() throws {
        let link = "fardesk://pair?d=abc123"
        #expect(QRPhotoDecoder.text(in: try photo(QRCodeImage.make(link))) == link)
    }

    @Test func aPhotoWithoutACodeGivesNothing() throws {
        let blank = CIImage(color: .white).cropped(to: CGRect(x: 0, y: 0, width: 300, height: 300))
        #expect(QRPhotoDecoder.text(in: try photo(blank)) == nil)
    }

    @Test func aTurnedPhotoIsReadWithItsOrientation() throws {
        let link = "fardesk://pair?d=turned"
        let image = try photo(try QRCodeImage.make(link).oriented(.right))
        #expect(QRPhotoDecoder.text(in: image, orientation: .left) == link)
    }
}
