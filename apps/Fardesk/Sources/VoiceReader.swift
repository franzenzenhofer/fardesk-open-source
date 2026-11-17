import AVFoundation
import FardeskModels
import FardeskStore
import Observation

/// Speaks assistant replies with the system voice. Which replies to speak and when hands-free may listen
/// is decided by `VoiceReplies` in FardeskStore; this class only drives `AVSpeechSynthesizer`.
@MainActor
@Observable
final class VoiceReader: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var isSpeaking = false
    /// Counts hands-free listen requests; the composer's mic starts dictation whenever it changes.
    private(set) var listenRequests = 0
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var queued = 0
    @ObservationIgnored private var wantsListen = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ replies: [SpokenReply], handsFree: Bool) {
        guard !replies.isEmpty else { return }
        configureAudio(handsFree: handsFree)
        wantsListen = handsFree
        for reply in replies {
            let utterance = AVSpeechUtterance(string: reply.text)
            utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
            queued += 1
            synthesizer.speak(utterance)
        }
        isSpeaking = true
    }

    /// Silences speech at once and cancels a pending hands-free listen.
    func stop() {
        wantsListen = false
        synthesizer.stopSpeaking(at: .immediate)
    }

    /// Starts hands-free listening once speech is over and the session is idle.
    func listenIfReady(status: SessionStatus) {
        let ready = VoiceReplies.shouldListen(handsFree: wantsListen, isSpeaking: isSpeaking, status: status)
        guard ready else { return }
        wantsListen = false
        listenRequests += 1
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.utteranceEnded() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.utteranceEnded() }
    }

    private func utteranceEnded() {
        queued = max(0, queued - 1)
        isSpeaking = queued > 0
    }

    private func configureAudio(handsFree: Bool) {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            if handsFree {
                try session.setCategory(.playAndRecord, options: [.defaultToSpeaker])
            } else {
                try session.setCategory(.playback)
            }
            try session.setActive(true)
        } catch {
            print("VoiceReader: audio session setup failed: \(error.localizedDescription)")
        }
        #endif
    }
}
