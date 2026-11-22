#if os(iOS)
import SwiftUI
import VisionKit

/// Lets the camera button reach the scanner it sits on: the live view hands itself over here, the button asks for a photo.
@MainActor
final class ScannerHandle {
    fileprivate weak var scanner: DataScannerViewController?

    /// A still photo from the running scanner, or nil when the scanner is gone or the capture failed.
    func capturePhoto() async -> UIImage? {
        try? await scanner?.capturePhoto()
    }
}

/// The live camera view that reads one QR code. VisionKit's `DataScannerViewController` is Apple's own scanner: it
/// brings the preview, the focus and the highlight of the code with it, so there is no capture session, preview layer
/// or orientation code of ours to keep right (the AVFoundation metadata output would need all of that). The camera
/// feed stays on the device: this view hands out the text of the code and nothing else, and stores nothing.
/// Give it a square (or any rect): the preview fills it with aspect-fill, never stretched.
struct QRScannerView: UIViewControllerRepresentable {
    /// Called on the main actor with the text of every code that comes into view.
    let onCode: @MainActor (String) -> Void
    let handle: ScannerHandle

    static var isSupported: Bool { DataScannerViewController.isSupported }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        handle.scanner = scanner
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.onCode = onCode
        handle.scanner = scanner
        guard !scanner.isScanning else { return }
        try? scanner.startScanning()
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onCode: @MainActor (String) -> Void

        init(onCode: @escaping @MainActor (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let code) in addedItems {
                if let text = code.payloadStringValue { onCode(text) }
            }
        }
    }
}
#endif
