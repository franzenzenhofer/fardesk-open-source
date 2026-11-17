import FardeskStore
import SwiftUI

/// One picture under a message: a rounded thumbnail (aspect fit, at most 160 pt high) that opens full screen on tap.
/// It owns its loading state, so the feed row around it stays cheap.
struct AttachmentThumbnail: View {
    static let maxHeight = 160.0
    private static let cornerRadius = 14.0

    private enum Phase {
        case loading
        case ready(CGImage)
        case failed
    }

    @Environment(AppModel.self) private var model
    let source: AttachmentImageSource
    let name: String
    @State private var phase = Phase.loading
    @State private var showsFull = false

    var body: some View {
        content
            .clipShape(.rect(cornerRadius: Self.cornerRadius))
            .task(id: source.key) { await load() }
            .sheet(isPresented: $showsFull) {
                if case .ready(let image) = phase { AttachmentFullScreen(image: image, name: name) }
            }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            placeholder { ProgressView() }
                .accessibilityLabel("Loading picture \(name)")
        case .ready(let image):
            Button { showsFull = true } label: {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: Self.maxHeight)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Picture \(name)")
            .accessibilityHint("Opens it full screen")
            .accessibilityIdentifier("attachment-thumbnail")
        case .failed:
            placeholder { Text("Image not available").font(.subheadline).foregroundStyle(.secondary).padding(8) }
        }
    }

    private func placeholder<Inside: View>(@ViewBuilder _ inside: () -> Inside) -> some View {
        inside()
            .frame(width: Self.maxHeight, height: Self.maxHeight * 0.75)
            .background(.secondary.opacity(0.12))
    }

    private func load() async {
        if let cached = AttachmentImageCache.shared.image(for: source.key) {
            phase = .ready(cached)
            return
        }
        phase = .loading
        do {
            let data = try await source.data(model: model)
            let image = await Task.detached { AttachmentImageCache.decode(data) }.value
            guard let image else { throw AttachmentImageError.undecodable }
            AttachmentImageCache.shared.store(image, for: source.key)
            phase = .ready(image)
        } catch is CancellationError {
            return
        } catch {
            phase = .failed
        }
    }
}

private enum AttachmentImageError: Error {
    case undecodable
}

/// The picture on its own, scaled to the screen, with a Done button.
private struct AttachmentFullScreen: View {
    @Environment(\.dismiss) private var dismiss
    let image: CGImage
    let name: String

    var body: some View {
        NavigationStack {
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFit()
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("Picture \(name)")
                .navigationTitle(name)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }.accessibilityIdentifier("attachment-done")
                    }
                }
        }
    }
}
