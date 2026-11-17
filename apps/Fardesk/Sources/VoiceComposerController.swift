#if os(iOS)
import FardeskStore
import Foundation
import Observation

/// Glue between the composer and `Dictation`: starts a recording, ends it as send / edit / cancel and
/// hands back the transcript and the finished file. What each ending means is `VoiceComposerFlow`'s call.
@MainActor
@Observable
final class VoiceComposerController {
    struct Ending {
        let outcome: VoiceOutcome
        /// The text the composer field should hold afterwards.
        let text: String
        /// The finished recording; nil when none was made or the recording is discarded.
        let audio: URL?
    }

    private let dictation = Dictation()
    private var flow = VoiceComposerFlow()
    private var textBefore = ""

    var isRecording: Bool { flow.isRecording }
    var level: Double { dictation.level }
    var startedAt: Date? { dictation.startedAt }
    var committed: String { dictation.state.committedText }
    var volatile: String { dictation.state.volatileText }
    var errorMessage: String? { dictation.state.errorMessage }

    func start(appendingTo text: String, recordAudio: Bool) async {
        guard flow.start() else { return }
        textBefore = text
        await dictation.start(appendingTo: text, recordAudio: recordAudio)
        if !dictation.isListening {
            _ = flow.finish(.cancel)
        } else if !flow.isRecording {
            await dictation.stop()
        }
    }

    func finish(_ how: VoiceFinish) async -> Ending? {
        guard let outcome = flow.finish(how) else { return nil }
        let file = await dictation.stop()
        switch outcome {
        case .sendNow, .moveToField:
            return Ending(outcome: outcome, text: dictation.state.fieldText, audio: file)
        case .discard:
            if let file { try? FileManager.default.removeItem(at: file) }
            return Ending(outcome: outcome, text: textBefore, audio: nil)
        }
    }

    /// Ends any running recording without a result, for example when the view goes away.
    func abandon() async {
        _ = await finish(.cancel)
    }
}
#endif
