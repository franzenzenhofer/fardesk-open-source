#if os(iOS)
import AVFoundation
import FardeskStore
import ImageIO
import SwiftUI

/// "Scan the QR code": the live camera on the first screen, behind the Tailscale gate (no Tailscale, no scanner). What it
/// reads goes to `AppModel.pair(link:)`, the same call for a code the live scanner detected and for one read from a photo
/// (the camera button at the bottom right of the scanner). The whole panel fits above the fold: the Tailscale line, the
/// scanner (a square that takes all the remaining space) and one instruction line.
struct ScanPairingPanel: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var access: CameraAccess = .checking
    @State private var isPairing = false
    @State private var photoMessage: String?
    @State private var handle = ScannerHandle()

    var body: some View {
        TailscaleGate {
            VStack(spacing: 12) {
                Label(TailscaleRequirement.onLine, systemImage: "checkmark.circle.fill")
                    .font(.body.weight(.semibold))
                    .accessibilityIdentifier("tailscale-on")
                scannerArea
                Text(TailscaleRequirement.scanInstruction)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboarding-scan")
        .task {
            access = await CameraAccess.resolve()
            #if DEBUG
            if let link = UserDefaults.standard.string(forKey: "FardeskScannedLink") { scanned(link) }
            #endif
        }
    }

    /// A square as large as the space allows, centred: the preview fills it with aspect-fill and is never stretched.
    private var scannerArea: some View {
        GeometryReader { proxy in
            let side = max(0, min(proxy.size.width, proxy.size.height))
            frame(side: side)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(maxWidth: .infinity, minHeight: 160, idealHeight: 240, maxHeight: .infinity)
    }

    @ViewBuilder
    private func frame(side: CGFloat) -> some View {
        switch access {
        case .checking:
            ProgressView().frame(width: side, height: side)
        case .allowed:
            ZStack(alignment: .bottomTrailing) {
                QRScannerView(onCode: scanned, handle: handle)
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay(TargetFrame())
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.primary, lineWidth: 2))
                photoButton.padding(10)
            }
            .overlay(alignment: .bottomLeading) { photoNote.padding(.leading, 10).padding(.bottom, 10).padding(.trailing, 76) }
            .frame(width: side, height: side)
        case .refused:
            notice(
                "The camera is off for Fardesk. To scan the code: open Settings, tap Fardesk, and switch on Camera.",
                action: { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
            )
            .frame(width: side)
        case .unsupported:
            notice("This device cannot scan codes.", action: nil).frame(width: side)
        }
    }

    /// Takes a photo of what the scanner sees and reads the code from it: the way in when the live scanner does not catch it.
    private var photoButton: some View {
        Button { Task { await takePhoto() } } label: {
            Image(systemName: "camera.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(.black))
                .overlay(Circle().stroke(.white, lineWidth: 2))
        }
        .accessibilityLabel("Take a photo of the code")
        .accessibilityIdentifier("scanner-photo")
    }

    @ViewBuilder
    private var photoNote: some View {
        if let photoMessage {
            Text(photoMessage)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .padding(8)
                .background(.black, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("scanner-photo-note")
        }
    }

    private func notice(_ text: String, action: (() -> Void)?) -> some View {
        VStack(spacing: 12) {
            Text(text).font(.body).multilineTextAlignment(.center)
            if let action {
                Button("Open Settings", action: action).buttonStyle(.fardeskSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.primary, lineWidth: 2))
    }

    private func takePhoto() async {
        photoMessage = nil
        guard let photo = await handle.capturePhoto(), let image = photo.cgImage,
              let text = QRPhotoDecoder.text(in: image, orientation: CGImagePropertyOrientation(photo.imageOrientation)) else {
            photoMessage = TailscaleRequirement.noCodeInPhoto
            return
        }
        scanned(text)
    }

    private func scanned(_ text: String) {
        guard !isPairing else { return }
        isPairing = true
        Task {
            await model.pair(link: text)
            isPairing = false
        }
    }
}

private extension CGImagePropertyOrientation {
    /// The orientation Vision needs for a UIImage (the two enums have different raw values).
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}

/// The visible square to hold the code in: white corner brackets with a black edge, readable on any picture.
private struct TargetFrame: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) * 0.7
            let origin = CGPoint(x: (proxy.size.width - side) / 2, y: (proxy.size.height - side) / 2)
            let arm = side * 0.2
            let brackets = Path { path in
                for (x, y, dx, dy) in [(0.0, 0.0, 1.0, 1.0), (side, 0, -1, 1), (0, side, 1, -1), (side, side, -1, -1)] {
                    path.move(to: CGPoint(x: origin.x + x + dx * arm, y: origin.y + y))
                    path.addLine(to: CGPoint(x: origin.x + x, y: origin.y + y))
                    path.addLine(to: CGPoint(x: origin.x + x, y: origin.y + y + dy * arm))
                }
            }
            ZStack {
                brackets.stroke(.black, style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                brackets.stroke(.white, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Whether the camera may be used: asked once, remembered by the system.
enum CameraAccess {
    case checking, allowed, refused, unsupported

    @MainActor
    static func resolve() async -> CameraAccess {
        guard QRScannerView.isSupported else { return .unsupported }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .allowed
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video) ? .allowed : .refused
        default: return .refused
        }
    }
}
#endif
