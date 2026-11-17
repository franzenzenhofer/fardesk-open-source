import FardeskStore
import SwiftUI

/// The composer while recording: elapsed time and level on top, the live transcript (still-changing
/// words lighter), an X to discard and a large check mark to finish and send. Tapping the transcript
/// stops and moves the text into the field for editing.
struct VoiceRecordingView: View {
    let elapsed: Double
    let level: Double
    let committed: String
    let volatile: String
    let onCancel: () -> Void
    let onEdit: () -> Void
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "record.circle.fill").foregroundStyle(StateColor.ok).accessibilityHidden(true)
                Text(ElapsedLabel.text(seconds: elapsed)).font(.body.monospacedDigit())
                LevelMeter(level: level)
                Spacer()
            }
            Button(action: onEdit) { transcript.frame(maxWidth: .infinity, alignment: .leading) }
                .buttonStyle(.plain)
                .accessibilityHint("Stops recording and lets you edit the text")
            HStack {
                Button("Discard recording", systemImage: "xmark", action: onCancel)
                    .labelStyle(.iconOnly)
                    .font(.title2)
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                Spacer()
                Button("Stop and send", systemImage: "checkmark", action: onSend)
                    .labelStyle(.iconOnly)
                    .font(.title.bold())
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .controlSize(.extraLarge)
                    .tint(StateColor.ok)
            }
        }
    }

    private var transcript: Text {
        if committed.isEmpty, volatile.isEmpty {
            return Text("Listening...").font(.body).foregroundStyle(.secondary)
        }
        var settled = AttributedString(committed)
        settled.foregroundColor = .primary
        var changing = AttributedString((committed.isEmpty || volatile.isEmpty ? "" : " ") + volatile)
        changing.foregroundColor = .secondary
        return Text(settled + changing).font(.body)
    }
}

/// A row of bars that fill from the left as the microphone gets louder.
struct LevelMeter: View {
    static let barCount = 12
    let level: Double
    private var bars: Int { Self.barCount }

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<bars, id: \.self) { index in
                Capsule()
                    .fill(Double(index) / Double(bars) < level ? StateColor.ok : StateColor.inactive.opacity(0.25))
                    .frame(width: 5, height: 16)
            }
        }
        .accessibilityHidden(true)
    }
}
