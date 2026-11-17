#if os(iOS)
@preconcurrency import AVFoundation
import Foundation

/// Writes microphone buffers to an AAC .m4a file (44.1 kHz, mono) in the temporary directory while the
/// same audio is being transcribed. Fed from the audio thread, finished once from `Session.close`.
final class VoiceFileSink: @unchecked Sendable {
    static let sampleRate = 44_100.0
    static let bitRate = 64_000

    let url: URL
    private var file: AVAudioFile?
    private let converter: BufferConverter
    private let lock = NSLock()
    private var failed = false

    init(microphone: AVAudioFormat) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: 1) else {
            throw VoiceFileError.formatUnavailable
        }
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString.prefix(8))")
            .appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: Self.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Self.bitRate,
        ]
        file = try AVAudioFile(
            forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false
        )
        converter = BufferConverter(from: microphone, to: format)
    }

    func write(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let file, !failed, let converted = converter.convert(buffer) else { return }
        do { try file.write(from: converted) } catch { failed = true }
    }

    /// Closes the file. The URL when every buffer was written, nil when a write failed.
    func finish() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        file = nil
        return failed ? nil : url
    }
}

enum VoiceFileError: Error {
    case formatUnavailable
}
#endif
