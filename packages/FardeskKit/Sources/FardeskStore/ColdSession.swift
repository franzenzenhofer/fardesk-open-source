import FardeskModels
import Foundation

/// What the user may choose when continuing a session whose prompt cache is cold.
public enum ColdChoice: String, Sendable, CaseIterable, Equatable {
    case resume
    case summary
    case startNew

    public var buttonTitle: String {
        switch self {
        case .resume: "Resume"
        case .summary: "Resume from summary"
        case .startNew: "Start new"
        }
    }
}

/// What a choice does to the typed message.
public enum ColdAction: Equatable, Sendable {
    /// Send the message to the session as it is.
    case sendAsIs
    /// Write a summary first, then send the message to the session that results.
    case compactThenSend
    /// Clear the running session, then send the message to the fresh one.
    case clearThenSend
    /// An ended session cannot be cleared: start a new one in the same folder and mode, the message is its first prompt.
    case newSessionWithPrompt
}

/// The decision "is this session cold, and what then", as pure functions (the app and the CLI share them).
public enum ColdSession {
    /// Below this size re-reading is cheap and nobody is asked.
    public static let minTokens = 20_000

    public static func isCold(contextTokens: Int?, cacheExpiresAt: Date?, now: Date) -> Bool {
        guard let contextTokens, let cacheExpiresAt else { return false }
        return contextTokens >= minTokens && cacheExpiresAt < now
    }

    public static func isCold(_ session: SessionSummary, now: Date) -> Bool {
        isCold(contextTokens: session.contextTokens, cacheExpiresAt: session.cacheExpiresAt, now: now)
    }

    /// "426k", "1.2M", "950".
    public static func tokensLabel(_ tokens: Int) -> String {
        switch tokens {
        case ..<1_000: "\(tokens)"
        case ..<1_000_000: "\(Int((Double(tokens) / 1_000).rounded()))k"
        default: String(format: "%.1fM", Double(tokens) / 1_000_000)
        }
    }

    /// "5 min", "3 h", "2 d".
    public static func idleLabel(since last: Date, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(last) / 60))
        switch minutes {
        case ..<60: return "\(max(1, minutes)) min"
        case ..<(60 * 24): return "\(minutes / 60) h"
        default: return "\(minutes / (60 * 24)) d"
        }
    }

    /// The Claude Code dialog, in one sentence.
    public static func warning(_ session: SessionSummary, now: Date) -> String {
        let idle = idleLabel(since: session.updatedAt, now: now)
        let size = session.contextTokens.map(tokensLabel) ?? "?"
        return "Resume this conversation? Inactive for \(idle) and \(size) tokens long. Continuing re-reads all of it."
    }

    /// The buttons offered. "Start new" needs something to start with: a message, or a running session to clear.
    public static func choices(for session: SessionSummary, hasMessage: Bool) -> [ColdChoice] {
        let canStartNew = hasMessage || session.status != .ended
        return ColdChoice.allCases.filter { $0 != .startNew || canStartNew }
    }

    public static func action(for choice: ColdChoice, session: SessionSummary) -> ColdAction {
        switch choice {
        case .resume: .sendAsIs
        case .summary: .compactThenSend
        case .startNew: session.status == .ended ? .newSessionWithPrompt : .clearThenSend
        }
    }
}
