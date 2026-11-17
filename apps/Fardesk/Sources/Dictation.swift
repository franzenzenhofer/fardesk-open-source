#if os(iOS)
@preconcurrency import AVFoundation
import FardeskStore
import Observation
import Speech

/// On-device dictation for the composer. All audio and speech work is here; what the text field
/// shows and when listening ends is decided by `DictationState` in FardeskStore.
@MainActor
@Observable
final class Dictation {
    private(set) var state = DictationState()
    /// Loudness of the latest microphone buffer, 0...1.
    private(set) var level = 0.0
    /// When the current recording began; nil while idle.
    private(set) var startedAt: Date?
    @ObservationIgnored private var session: Session?

    var isListening: Bool { state.isListening }

    /// Starts listening; the dictated words follow `existing`. With `recordAudio` the same audio is
    /// written to an AAC .m4a file in the temporary directory.
    func start(appendingTo existing: String, recordAudio: Bool) async {
        guard !isListening else { return }
        state.start(appendingTo: existing)
        startedAt = Date()
        do {
            session = try await Session.open(
                recordsAudio: recordAudio,
                onText: { [weak self] text, isFinal in self?.state.hear(text, isFinal: isFinal) },
                onLevel: { [weak self] rms in self?.show(level: AudioLevel.normalized(rms: rms)) },
                onFailure: { [weak self] message in
                    Task { _ = await self?.stop(); self?.state.fail(message) }
                }
            )
        } catch {
            startedAt = nil
            state.fail(Self.message(for: error))
        }
    }

    /// The meter has a fixed number of bars: the level only changes when the number of lit bars does,
    /// so the recording view is not redrawn for sound changes nobody can see.
    private func show(level raw: Double) {
        let lit = (raw * Double(LevelMeter.barCount)).rounded(.up)
        let snapped = lit / Double(LevelMeter.barCount)
        if snapped != level { level = snapped }
    }

    /// Stops listening, finalizes the transcript and returns the finished recording, if one was made.
    @discardableResult
    func stop() async -> URL? {
        let open = session
        session = nil
        startedAt = nil
        level = 0
        guard let open else {
            state.stop()
            return nil
        }
        let file = await open.close()
        state.stop()
        return file
    }

    private static func message(for error: any Error) -> String {
        (error as? DictationError)?.message ?? error.localizedDescription
    }
}

private enum DictationError: Error {
    case microphoneDenied
    case languageUnsupported

    var message: String {
        switch self {
        case .microphoneDenied: "Microphone access is off. Allow it in Settings."
        case .languageUnsupported: "On-device dictation is not available for this language."
        }
    }
}

/// One running microphone-to-text pipeline: engine, converter, analyzer and the task reading results.
/// Opened, used and closed one step at a time from `Dictation`, never from two places at once.
private final class Session: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let analyzer: SpeechAnalyzer
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let results: Task<Void, Never>
    private let recordsAudio: Bool
    private let onLevel: @Sendable (Float) -> Void
    private var sink: VoiceFileSink?

    private init(
        analyzer: SpeechAnalyzer,
        input: AsyncStream<AnalyzerInput>.Continuation,
        results: Task<Void, Never>,
        recordsAudio: Bool,
        onLevel: @escaping @Sendable (Float) -> Void
    ) {
        self.analyzer = analyzer
        self.input = input
        self.results = results
        self.recordsAudio = recordsAudio
        self.onLevel = onLevel
    }

    static func open(
        recordsAudio: Bool,
        onText: @escaping @MainActor (String, Bool) -> Void,
        onLevel: @escaping @MainActor (Float) -> Void,
        onFailure: @escaping @MainActor (String) -> Void
    ) async throws -> Session {
        guard await AVAudioApplication.requestRecordPermission() else { throw DictationError.microphoneDenied }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) else {
            throw DictationError.languageUnsupported
        }
        let transcriber = SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: []
        )
        if await AssetInventory.status(forModules: [transcriber]) < .installed {
            try await AssetInventory.assetInstallationRequest(supporting: [transcriber])?.downloadAndInstall()
        }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw DictationError.languageUnsupported
        }
        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
        let results = Task {
            do {
                for try await result in transcriber.results {
                    await onText(String(result.text.characters), result.isFinal)
                }
            } catch {
                await onFailure(error.localizedDescription)
            }
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let session = Session(
            analyzer: analyzer, input: input, results: results, recordsAudio: recordsAudio,
            onLevel: { rms in Task { @MainActor in onLevel(rms) } }
        )
        do {
            try await analyzer.start(inputSequence: stream)
            try session.startMicrophone(format: format)
        } catch {
            _ = await session.close()
            throw error
        }
        return session
    }

    /// Stops the microphone, lets the analyzer finish what it heard, and returns the recorded file.
    func close() async -> URL? {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        input.finish()
        try? await analyzer.finalizeAndFinishThroughEndOfInput()
        await results.value
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return sink?.finish()
    }

    private func startMicrophone(format: AVAudioFormat) throws {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement)
        try audio.setActive(true)
        let microphone = engine.inputNode.outputFormat(forBus: 0)
        let converter = BufferConverter(from: microphone, to: format)
        let input = input
        let onLevel = onLevel
        if recordsAudio { sink = try VoiceFileSink(microphone: microphone) }
        let sink = sink
        engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: microphone) { buffer, _ in
            onLevel(Self.rms(of: buffer))
            sink?.write(buffer)
            if let converted = converter.convert(buffer) { input.yield(AnalyzerInput(buffer: converted)) }
        }
        engine.prepare()
        try engine.start()
    }
}

extension Session {
    /// Root-mean-square of the first channel of a buffer, 0...1.
    fileprivate static func rms(of buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for frame in 0..<Int(buffer.frameLength) { sum += channel[frame] * channel[frame] }
        return (sum / Float(buffer.frameLength)).squareRoot()
    }
}

/// Converts microphone buffers to the format the analyzer wants.
final class BufferConverter: @unchecked Sendable {
    private let converter: AVAudioConverter?
    private let target: AVAudioFormat

    init(from source: AVAudioFormat, to target: AVAudioFormat) {
        self.target = target
        converter = source == target ? nil : AVAudioConverter(from: source, to: target)
    }

    func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else { return buffer }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        nonisolated(unsafe) var supplied = false
        var failure: NSError?
        let status = converter.convert(to: output, error: &failure) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        return status == .error ? nil : output
    }
}
#endif
