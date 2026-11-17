import FardeskModels

/// The round status glyph at the left of a session row in the machines list (mockup 01).
public struct SessionRowGlyph: Equatable, Sendable {
    public let symbolName: String
    /// Green while working, orange while it waits for you, grey when idle or ended.
    public let tint: StateTone
    public let pulses: Bool

    public init(status: SessionStatus) {
        tint = StateTone(status: status)
        switch status {
        case .waiting: (symbolName, pulses) = ("exclamationmark.circle.fill", false)
        case .working: (symbolName, pulses) = ("play.circle.fill", true)
        case .idle: (symbolName, pulses) = ("pause.circle.fill", false)
        case .ended: (symbolName, pulses) = ("checkmark.circle", false)
        }
    }
}

/// The orange "N needs you" text in the bottom bar; nothing when no session waits.
public enum NeedsYouLabel {
    public static func text(count: Int) -> String? {
        count > 0 ? "\(count) needs you" : nil
    }
}
