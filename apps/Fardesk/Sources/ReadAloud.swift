import FardeskModels
import FardeskStore
import SwiftUI

enum VoiceSettings {
    static let readAloudKey = "voice.readAloud"
    static let handsFreeKey = "voice.handsFree"
}

/// The two voice toggles of the session menu. Hands-free needs dictation, which is iPhone and iPad only.
struct VoiceMenuItems: View {
    @AppStorage(VoiceSettings.readAloudKey) private var readAloud = false
    @AppStorage(VoiceSettings.handsFreeKey) private var handsFree = false

    var body: some View {
        Toggle("Read Aloud", systemImage: "speaker.wave.2", isOn: $readAloud)
        #if os(iOS)
        Toggle("Hands-free", systemImage: "mic.badge.plus", isOn: $handsFree).disabled(!readAloud)
        #endif
    }
}

/// Settings row for the same switch.
struct ReadAloudRow: View {
    @AppStorage(VoiceSettings.readAloudKey) private var readAloud = false

    var body: some View {
        Toggle("Read replies aloud", isOn: $readAloud)
    }
}

/// Speaks every new assistant reply of the open session while Read Aloud is on. Old history is never read:
/// only rows newer than the moment the session opened or the toggle went on.
private struct ReadsAloud: ViewModifier {
    let box: FeedBox
    let status: SessionStatus
    @AppStorage(VoiceSettings.readAloudKey) private var readAloud = false
    @AppStorage(VoiceSettings.handsFreeKey) private var handsFree = false
    @Environment(VoiceReader.self) private var reader
    @State private var since = Date()
    @State private var spoken = Set<String>()

    func body(content: Content) -> some View {
        content
            .onChange(of: readAloud ? box.feed.activities.last : nil) { speakNew() }
            .onChange(of: readAloud) { _, isOn in
                since = Date()
                if !isOn { reader.stop() }
            }
            .onChange(of: reader.isSpeaking) { reader.listenIfReady(status: status) }
            .onChange(of: status) { reader.listenIfReady(status: status) }
            .onAppear { since = Date() }
            .onDisappear { reader.stop() }
    }

    private func speakNew() {
        guard readAloud else { return }
        let replies = VoiceReplies.toSpeak(in: box.feed.activities, since: since, spoken: spoken)
        spoken.formUnion(replies.map(\.id))
        reader.speak(replies, handsFree: handsFree)
    }
}

extension View {
    func readsAloud(box: FeedBox, status: SessionStatus) -> some View {
        modifier(ReadsAloud(box: box, status: status))
    }
}
