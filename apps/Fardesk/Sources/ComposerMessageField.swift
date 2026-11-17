import FardeskStore
import SwiftUI

/// The reply field: picture buttons, the text with a mic inside, a round send button, and while
/// recording the voice state instead. `send` returns true when the message was accepted; only then
/// is the composer cleared.
struct MessageField: View {
    let send: (ComposerMessage) async -> Bool
    @State private var text = ""
    @State private var images: [ComposerImage] = []
    @State private var files: [ComposerFile] = []
    @State private var attachmentError: String?
    #if os(iOS)
    @Environment(VoiceReader.self) private var reader
    @AppStorage(VoiceAttachSettings.key) private var attachesRecording = false
    @State private var voice = VoiceComposerController()
    @State private var pendingAudio: URL?
    #endif

    private var canSend: Bool { ComposerSendRule.canSend(text: text, imageCount: images.count, fileCount: files.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let message = attachmentError {
                Text(message).font(.footnote).foregroundStyle(StateColor.broken).accessibilityIdentifier("attachment-error")
            }
            #if os(iOS)
            if let message = voice.errorMessage { Text(message).font(.footnote).foregroundStyle(StateColor.broken) }
            if pendingAudio != nil {
                HStack {
                    Label("Voice recording attached", systemImage: "waveform")
                    Button("Remove recording", systemImage: "xmark.circle.fill", action: discardPendingAudio)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                }
                .font(.body)
                .foregroundStyle(.secondary)
            }
            #endif
            if !images.isEmpty {
                ComposerImageStrip(images: images) { id in images.removeAll { $0.id == id } }
            }
            if !files.isEmpty {
                ComposerFileChips(files: files) { id in files.removeAll { $0.id == id } }
            }
            #if os(iOS)
            if voice.isRecording { recordingBody } else { fieldRow }
            #else
            fieldRow
            #endif
        }
        #if os(iOS)
        .onChange(of: reader.listenRequests) { startRecording() }
        .onDisappear { Task { await voice.abandon() } }
        #endif
    }

    private var fieldRow: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ComposerAddMenu(
                remainingSlots: ComposerFileRules.remainingSlots(images: images.count, files: files.count),
                onAddImages: { attachmentError = nil; images += $0 },
                onAddFiles: { attachmentError = nil; files += $0 },
                onError: { attachmentError = $0 }
            )
            HStack(alignment: .center) {
                TextField("Reply...", text: $text, axis: .vertical)
                    .accessibilityIdentifier("composer-field")
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .onSubmit { submit(audio: audioToSend) }
                #if os(iOS)
                DictationButton(action: startRecording)
                #endif
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(.secondary.opacity(0.25)))
            Button { submit(audio: audioToSend) } label: {
                Image(systemName: FeedSymbol.sendArrow).font(.body.bold()).foregroundStyle(.background)
            }
            .accessibilityLabel("Send")
            .accessibilityIdentifier("send-button")
            .buttonStyle(.borderedProminent)
            .tint(.primary)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .disabled(!canSend)
        }
    }

    private var audioToSend: URL? {
        #if os(iOS)
        pendingAudio
        #else
        nil
        #endif
    }

    private func submit(audio: URL?) {
        guard canSend else { return }
        TapClock.start("send.pending")
        let message = ComposerMessage(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines), audio: audio, images: images, files: files
        )
        // Cleared at once: a second tap on Send finds nothing to send, and the message is in the feed already.
        let restoreText = text
        let restoreImages = images
        let restoreFiles = files
        text = ""
        images = []
        files = []
        attachmentError = nil
        #if os(iOS)
        pendingAudio = nil
        #endif
        Task {
            guard await send(message) else {
                text = restoreText
                images = restoreImages
                files = restoreFiles
                return
            }
        }
    }
}

#if os(iOS)
extension MessageField {
    fileprivate var recordingBody: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            VoiceRecordingView(
                elapsed: voice.startedAt.map { context.date.timeIntervalSince($0) } ?? 0,
                level: voice.level,
                committed: voice.committed,
                volatile: voice.volatile,
                onCancel: { finishRecording(.cancel) },
                onEdit: { finishRecording(.edit) },
                onSend: { finishRecording(.send) }
            )
        }
    }

    fileprivate func startRecording() {
        guard !voice.isRecording else { return }
        reader.stop()
        discardPendingAudio()
        Task { await voice.start(appendingTo: text, recordAudio: attachesRecording) }
    }

    fileprivate func finishRecording(_ how: VoiceFinish) {
        Task {
            guard let ending = await voice.finish(how) else { return }
            text = ending.text
            let audio = attachesRecording ? ending.audio : nil
            switch ending.outcome {
            case .sendNow: submit(audio: audio)
            case .moveToField: pendingAudio = audio
            case .discard: break
            }
        }
    }

    func discardPendingAudio() {
        if let file = pendingAudio { try? FileManager.default.removeItem(at: file) }
        pendingAudio = nil
    }
}
#endif
