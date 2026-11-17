import SwiftUI

enum VoiceAttachSettings {
    static let key = "voice.attachRecording"
}

/// Settings row: send the recorded voice message along with its transcript.
struct VoiceAttachRow: View {
    @AppStorage(VoiceAttachSettings.key) private var attach = false

    var body: some View {
        #if os(iOS)
        Toggle("Attach voice recording", isOn: $attach)
        #endif
    }
}
