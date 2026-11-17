import FardeskClient
import Foundation

/// Words for an error that always name the machine and the action, never a bare system phrase.
public enum ErrorText {
    /// System texts that say nothing: they get the error domain and code appended.
    private static let bare: Set<String> = ["", "unknown error", "an unknown error occurred.", "cancelled", "unknown"]

    /// The error's own words; a bare or empty system text is completed with "(domain code)".
    public static func detail(_ error: any Error) -> String {
        let text = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard bare.contains(text.lowercased()) else { return text }
        let ns = error as NSError
        return text.isEmpty ? "\(ns.domain) \(ns.code)" : "\(text) (\(ns.domain) \(ns.code))"
    }

    /// "Laptop: could not load activity: The request timed out."
    public static func message(machine: String, action: String, error: any Error) -> String {
        "\(machine): could not \(action): \(detail(error))"
    }
}

/// Whether an error is the app cancelling its own request (a view went away): never worth a word.
extension Error {
    public var isCancellation: Bool {
        if self is CancellationError { return true }
        if let url = self as? URLError { return url.code == .cancelled }
        if case .transport(let url)? = self as? FardeskAPIError { return url.code == .cancelled }
        return false
    }
}

/// Who asked for a call: the user (a failure may alert) or the app on its own (a failure is silent).
public enum CallOrigin: Sendable {
    case user
    case background
}

/// Decides whether an alert may be raised: one at a time, and the same text is not repeated
/// within `repeatWindow`.
public struct AlertGate: Sendable, Equatable {
    public static let repeatWindow: TimeInterval = 60

    private var lastMessage: String?
    private var lastRaisedAt: Date?

    public init() {}

    /// True (and remembered) when `message` may be shown now; `showing` is the alert on screen.
    public mutating func admit(_ message: String, showing: String?, now: Date) -> Bool {
        guard showing == nil else { return false }
        if message == lastMessage, let lastRaisedAt, now.timeIntervalSince(lastRaisedAt) < Self.repeatWindow {
            return false
        }
        lastMessage = message
        lastRaisedAt = now
        return true
    }
}
