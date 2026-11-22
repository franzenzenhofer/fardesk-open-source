import FardeskModels
import FardeskStore
import PhotosUI
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The Image section of the Session info sheet: choose a photo, take one, or remove the chat's own image.
/// The picture is downscaled to 512 px and sent as a JPEG; the list row then shows it instead of the agent avatar.
struct ChatImageEditor: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let session: SessionSummary
    @State private var picked: PhotosPickerItem?
    @State private var working = false
    @State private var failure: String?
    @State private var askedSignal = 0
    #if os(iOS)
    @State private var showsCamera = false
    #endif

    var body: some View {
        if model.machineSupports(.chatImage, on: ref.machineID) {
            editor
        } else {
            needsUpdate
        }
    }

    private var machineName: String { model.state.machines.first { $0.id == ref.machineID }?.endpoint.name ?? "the machine" }

    /// A machine without the feature gets the way to update it, not a picker that would fail.
    private var needsUpdate: some View {
        Section {
            Text("Update \(machineName) to give chats an image").font(.body)
            if model.updatePlan.needsUpdate(ref.machineID) { UpdateAllButton() }
        } header: {
            Text("Image")
        }
        .accessibilityIdentifier("chat-image-needs-update")
    }

    private var editor: some View {
        Section {
            if let hash = session.label.image {
                ChatImageView(key: ChatImageKey(ref: ref, hash: hash)) { ProgressView() }
                    .frame(width: 64, height: 64)
                    .clipShape(.circle)
                    .accessibilityLabel("Current chat image")
            }
            PhotosPicker("Choose photo", selection: $picked, matching: .images)
                .accessibilityIdentifier("chat-image-choose")
            #if os(iOS)
            if CameraPicker.isAvailable {
                Button("Take photo") { showsCamera = true }.accessibilityIdentifier("chat-image-camera")
            }
            #endif
            if makingImage {
                coordinatorAtWork
            } else if model.coordinatorForImages != nil {
                Button("Ask the coordinator for a suitable image") { Task { await askCoordinator() } }
                    .accessibilityIdentifier("chat-image-coordinator")
            }
            if session.label.image != nil {
                Button("Remove image", role: .destructive) { Task { await remove() } }
                    .accessibilityIdentifier("chat-image-remove")
            }
        } header: {
            Text("Image")
        } footer: {
            Text(failure ?? (makingImage
                ? "It appears here and in the list once the coordinator has set it."
                : "Shown in the list instead of the agent's picture."))
        }
        .sensoryFeedback(.success, trigger: askedSignal)
        .disabled(working)
        .disabledInDemo(.sessionActions)
        .onChange(of: picked) { _, item in if let item { load(item) } }
        #if os(iOS)
        .fullScreenCover(isPresented: $showsCamera) {
            CameraPicker { photo in Task { await upload(photo.jpegData(compressionQuality: 0.95)) } }
                .ignoresSafeArea()
        }
        #endif
    }

    /// True from the tap until the new image arrives: the button is gone, so it cannot be pressed again and again.
    private var makingImage: Bool { model.isMakingImage(ref, currentImage: session.label.image) }

    /// Takes the button's place while the coordinator works: plainly not a button, with a spinner.
    private var coordinatorAtWork: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text("The coordinator is making an image")
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat-image-coordinator-working")
    }

    /// The coordinator makes the picture on the hub and sets it itself; the row shows it once it arrives.
    private func askCoordinator() async {
        working = true
        defer { working = false }
        failure = nil
        if await model.askCoordinatorForImage(ref) {
            askedSignal += 1
        } else {
            failure = "The coordinator did not take the job. Try again when the hub answers."
        }
    }

    private func load(_ item: PhotosPickerItem) {
        picked = nil
        Task { await upload(try? await item.loadTransferable(type: Data.self)) }
    }

    private func upload(_ original: Data?) async {
        working = true
        defer { working = false }
        failure = nil
        let jpeg = await Task.detached(priority: .userInitiated) { original.flatMap(ChatImageCodec.uploadJPEG(from:)) }.value
        guard let jpeg else {
            failure = "This picture could not be read. Choose another one."
            return
        }
        if await !model.setImage(jpeg, mediaType: "image/jpeg", for: ref) {
            failure = "The image could not be saved on the computer."
        }
    }

    private func remove() async {
        working = true
        defer { working = false }
        failure = nil
        if await !model.clearImage(ref) { failure = "The image could not be removed." }
    }
}
