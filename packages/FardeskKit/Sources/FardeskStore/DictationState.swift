/// The state machine behind the composer's mic button: idle, listening, the text heard so far, or an error.
/// The audio and speech code in the app only feeds it; everything that decides lives here.
public struct DictationState: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case idle
        case listening
        case failed(String)
    }

    public private(set) var phase = Phase.idle
    private var base = ""
    private var finalized = ""
    private var volatile = ""

    public init() {}

    public var isListening: Bool { phase == .listening }

    /// What the reply field shows: the text that was there when listening began, then what was heard.
    public var fieldText: String { Self.join(base, Self.join(finalized, volatile)) }

    /// The settled part of the field: what was typed before plus the final segments heard.
    public var committedText: String { Self.join(base, finalized) }

    /// The still-changing tail of the transcript, shown lighter until it is final.
    public var volatileText: String { volatile }

    public var errorMessage: String? {
        if case .failed(let message) = phase { message } else { nil }
    }

    /// Starts listening; what the user already typed stays in front of the dictated words.
    public mutating func start(appendingTo existing: String) {
        base = existing
        finalized = ""
        volatile = ""
        phase = .listening
    }

    /// A transcription result: a final segment is kept, a volatile one is replaced by the next result.
    public mutating func hear(_ text: String, isFinal: Bool) {
        guard isListening else { return }
        if isFinal {
            finalized = Self.join(finalized, text)
            volatile = ""
        } else {
            volatile = text
        }
    }

    /// Stops listening and keeps everything heard in the field.
    public mutating func stop() {
        base = fieldText
        finalized = ""
        volatile = ""
        if isListening { phase = .idle }
    }

    /// Stops listening because something went wrong; what was heard before stays in the field.
    public mutating func fail(_ message: String) {
        stop()
        phase = .failed(message)
    }

    private static func join(_ first: String, _ second: String) -> String {
        let a = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = second.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return first }
        return first.hasSuffix(" ") || first.hasSuffix("\n") ? first + b : first + " " + b
    }
}
