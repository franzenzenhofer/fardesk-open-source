import Foundation

/// How a recording in the composer ends: the check mark sends, tapping the text edits, the X discards.
public enum VoiceFinish: Equatable, Sendable {
    case send
    case edit
    case cancel
}

/// What the composer does with the transcript and the recorded file once recording has ended.
public enum VoiceOutcome: Equatable, Sendable {
    /// Send the transcript now, with the audio when the user asked for it.
    case sendNow
    /// Put the transcript into the text field for editing; the audio stays pending.
    case moveToField
    /// Drop the transcript and the audio.
    case discard
}

/// The two states of the composer's voice mode. Pure: the audio code only reports into it.
public struct VoiceComposerFlow: Equatable, Sendable {
    public private(set) var isRecording = false

    public init() {}

    /// Recording begins. False when it was already recording (the tap is ignored).
    @discardableResult
    public mutating func start() -> Bool {
        guard !isRecording else { return false }
        isRecording = true
        return true
    }

    /// Recording ends. Nil when nothing was recording.
    public mutating func finish(_ how: VoiceFinish) -> VoiceOutcome? {
        guard isRecording else { return nil }
        isRecording = false
        switch how {
        case .send: return .sendNow
        case .edit: return .moveToField
        case .cancel: return .discard
        }
    }
}

/// Text for the elapsed-time label while recording.
public enum ElapsedLabel {
    /// "0:07", "12:03", "1:02:09".
    public static func text(seconds: Double) -> String {
        let whole = max(0, Int(seconds.rounded(.down)))
        let hours = whole / 3600
        let minutes = (whole % 3600) / 60
        let rest = whole % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, rest) }
        return String(format: "%d:%02d", minutes, rest)
    }
}

/// Maps microphone loudness to the 0...1 height of the level indicator.
public enum AudioLevel {
    public static let floorDecibels: Float = -50

    /// `rms` is the root-mean-square of a buffer, 0...1. Silence is 0, full scale is 1.
    public static func normalized(rms: Float) -> Double {
        guard rms > 0 else { return 0 }
        let decibels = 20 * log10(rms)
        if decibels <= floorDecibels { return 0 }
        if decibels >= 0 { return 1 }
        return Double((decibels - floorDecibels) / -floorDecibels)
    }
}

/// Size and format decisions for pictures attached in the composer.
public enum ComposerImageSizing {
    public static let maxSide = 2048
    public static let jpegQuality = 0.85

    /// The pixel size to ship: the longest side is at most `maxSide`, never upscaled, aspect kept.
    public static func fittedSize(width: Int, height: Int, maxSide: Int = maxSide) -> (width: Int, height: Int) {
        guard width > 0, height > 0, maxSide > 0 else { return (0, 0) }
        let longest = max(width, height)
        guard longest > maxSide else { return (width, height) }
        let scale = Double(maxSide) / Double(longest)
        return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
    }

    /// PNG sources (screenshots) stay PNG, everything else becomes JPEG.
    public static func keepsPNG(sourceTypeIdentifier: String?) -> Bool {
        sourceTypeIdentifier == "public.png"
    }
}

/// When the composer's send button is live.
public enum ComposerSendRule {
    public static func canSend(text: String, imageCount: Int, fileCount: Int = 0) -> Bool {
        imageCount > 0 || fileCount > 0 || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
