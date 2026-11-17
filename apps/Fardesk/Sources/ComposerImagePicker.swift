import FardeskStore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#endif

/// The "+" button of the composer. Its menu offers Photo Library, Camera (iPhone and iPad with a camera)
/// and Files. Everything chosen is converted (pictures downscaled, files read) and handed on.
struct ComposerAddMenu: View {
    let remainingSlots: Int
    let onAddImages: ([ComposerImage]) -> Void
    let onAddFiles: ([ComposerFile]) -> Void
    let onError: (String) -> Void
    @State private var picked: [PhotosPickerItem] = []
    @State private var showsLibrary = false
    @State private var showsFiles = false
    #if os(iOS)
    @State private var showsCamera = false
    #endif

    var body: some View {
        Menu {
            Button("Photo Library", systemImage: "photo.on.rectangle") { showsLibrary = true }
            #if os(iOS)
            if CameraPicker.isAvailable {
                Button("Camera", systemImage: "camera") { showsCamera = true }
            }
            #endif
            Button("Files", systemImage: "doc") { showsFiles = true }
        } label: {
            Image(systemName: "plus")
                .font(.title3.weight(.semibold))
                .frame(width: 36, height: 36)
                .background(.secondary.opacity(0.15), in: .circle)
        }
        .accessibilityLabel("Add attachment")
        .accessibilityIdentifier("add-attachment-button")
        .disabled(remainingSlots == 0)
        .photosPicker(
            isPresented: $showsLibrary, selection: $picked, maxSelectionCount: max(1, remainingSlots), matching: .images
        )
        .fileImporter(isPresented: $showsFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            importFiles(result)
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showsCamera) {
            CameraPicker { photo in addCameraPhoto(photo) }
            .ignoresSafeArea()
        }
        #endif
        .onChange(of: picked) { _, items in loadPhotos(items) }
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        picked = []
        let limit = remainingSlots
        Task {
            var images: [ComposerImage] = []
            for item in items.prefix(limit) {
                guard let data = try? await item.loadTransferable(type: Data.self),
                    let image = await Self.convert(data)
                else { continue }
                images.append(image)
            }
            if !images.isEmpty { onAddImages(images) }
        }
    }

    /// Decoding, downscaling and encoding a 12 to 48 MP picture takes hundreds of milliseconds: never on the main thread.
    private nonisolated static func convert(_ data: Data) async -> ComposerImage? {
        await Task.detached(priority: .userInitiated) { ComposerImageLoader.make(from: data) }.value
    }

    #if os(iOS)
    private func addCameraPhoto(_ photo: UIImage) {
        Task {
            let image = await Task.detached(priority: .userInitiated) { () -> ComposerImage? in
                guard let data = photo.jpegData(compressionQuality: 0.95) else { return nil }
                return ComposerImageLoader.make(from: data)
            }.value
            if let image { onAddImages([image]) }
        }
    }
    #endif

    private func importFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error): onError("Files could not be opened: \(error.localizedDescription)")
        case .success(let urls):
            let limit = remainingSlots
            Task {
                let outcome = await Task.detached(priority: .userInitiated) { ComposerFileLoader.load(urls, limit: limit) }.value
                if !outcome.files.isEmpty { onAddFiles(outcome.files) }
                if !outcome.errors.isEmpty { onError(outcome.errors.joined(separator: "\n")) }
            }
        }
    }
}
