import FardeskModels

/// The status glyph of a session, the one table for the list, the chat header and the widgets
/// (docs/design/STATES.md). No pause sign and no check mark: a pause reads as "stopped by someone" and a check as
/// "approved", and neither is what the session is doing.
public struct SessionRowGlyph: Equatable, Sendable {
    public init(session: SessionSummary) {
        self.init(status: session.status, waitingFor: session.waitingFor, background: session.background)
    }

    public let symbolName: String
    /// Green while working, orange while it needs you, black when it is your turn, grey when stopped.
    public let tint: StateTone
    public let pulses: Bool

    /// `waitingFor`: a dialog at the computer gets the computer sign, so it reads as "go to the computer".
    /// `background`: a finished turn with background jobs still running is green and outlined, not "your turn".
    public init(status: SessionStatus, waitingFor: WaitingReason? = nil, background: Int = 0) {
        if status == .idle, background > 0 {
            (symbolName, tint, pulses) = (FardeskSymbol.workingInBackground, .ok, false)
            return
        }
        tint = StateTone(status: status)
        switch status {
        case .waiting where waitingFor == .terminal: (symbolName, pulses) = (FardeskSymbol.waitingAtComputer, false)
        case .waiting: (symbolName, pulses) = (FardeskSymbol.waiting, false)
        case .working: (symbolName, pulses) = (FardeskSymbol.working, true)
        case .idle: (symbolName, pulses) = (FardeskSymbol.idle, false)
        case .ended: (symbolName, pulses) = (FardeskSymbol.ended, false)
        case .unknown: (symbolName, pulses) = (FardeskSymbol.unknown, false)
        }
    }
}

/// The orange "N needs you" text in the bottom bar; nothing when no session waits.
public enum NeedsYouLabel {
    public static func text(count: Int) -> String? {
        count > 0 ? "\(count) needs you" : nil
    }
}
