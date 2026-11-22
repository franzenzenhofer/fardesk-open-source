import CoreImage
import CoreImage.CIFilterBuiltins
import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing
import Vision

/// The QR scanner of the iPhone app hands the text of the code to `AppModel.pair(link:)`, the same call the pasted link
/// uses. These tests draw a real QR code of a real pairing link, read it back with the Vision framework (the engine
/// behind the camera scanner), and push the scanned text and the pasted text through the one pairing path.
enum QRCodeImage {
    /// A QR code of `text` with a white border, as an image a scanner can read.
    static func make(_ text: String) throws -> CIImage {
        let generator = CIFilter.qrCodeGenerator()
        generator.message = Data(text.utf8)
        generator.correctionLevel = "M"
        guard let code = generator.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else {
            throw QRCodeError.notDrawn
        }
        let border = code.extent.insetBy(dx: -64, dy: -64)
        return code.composited(over: CIImage(color: .white).cropped(to: border)).cropped(to: border)
    }

    /// What a scanner reads out of `image`: the text of every QR code in it.
    static func scan(_ image: CIImage) throws -> [String] {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        try VNImageRequestHandler(ciImage: image).perform([request])
        return (request.results ?? []).compactMap(\.payloadStringValue)
    }

    enum QRCodeError: Error { case notDrawn }
}

@MainActor
struct ScannedLinkTests {
    @Test func aScannedCodeReadsBackAsTheSameStringAsThePastedLink() async throws {
        try await TestDaemon.with { daemon in
            let pasted = try await PairingLinks.make(for: daemon, name: "scanned")
            let scanned = try #require(try QRCodeImage.scan(QRCodeImage.make(pasted)).first)
            #expect(scanned == pasted)
            #expect(try PairingLink.parse(scanned) == PairingLink.parse(pasted))
        }
    }

    @Test func aScannedLinkAndAPastedLinkReachTheSameExchange() async throws {
        try await TestDaemon.with { daemon in
            for source in ["pasted", "scanned"] {
                try await StoreSandbox.with { sandbox in
                    let model = AppModel(configuration: sandbox.configuration())
                    await model.start()
                    let link = try await PairingLinks.make(for: daemon, name: source)
                    let text = source == "pasted" ? link : try #require(try QRCodeImage.scan(QRCodeImage.make(link)).first)
                    await model.pair(link: text)
                    #expect(model.phase == .ready, "\(source): \(model.loginError ?? "no error")")
                    #expect(model.machines.endpoints.map(\.name) == [source])
                    let id = try #require(model.machines.endpoints.first?.id)
                    #expect(try sandbox.keychainTokens.load(id) != nil, "\(source): the device token is stored")
                    model.stop()
                }
            }
        }
    }

    @Test func aScannedCodeThatIsNotAPairingLinkIsRefusedInWords() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.start()
            let scanned = try #require(try QRCodeImage.scan(QRCodeImage.make("https://example.com/menu")).first)
            await model.pair(link: scanned)
            #expect(model.phase != .ready)
            #expect(model.machines.endpoints.isEmpty)
            #expect(model.loginError?.contains("Not a Fardesk pairing link") == true)
            model.stop()
        }
    }
}
