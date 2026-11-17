import FardeskModels
import Foundation

/// One assistant reply ready to be spoken.
public struct SpokenReply: Equatable, Sendable, Identifiable {
    public let id: String
    public let text: String

    public init(id: String, text: String) {
        self.id = id
        self.text = text
    }
}

public enum VoiceReplies {
    /// The replies to read aloud now: assistant text rows newer than `since` (the moment Read Aloud went
    /// on or the session opened) that were not spoken yet and have something left after stripping markdown.
    /// Tool rows, user rows and old history are never spoken.
    public static func toSpeak(in activities: [Activity], since: Date, spoken: Set<String>) -> [SpokenReply] {
        activities.compactMap { activity in
            guard case .assistant(let reply) = activity, reply.ts > since, !spoken.contains(reply.id) else { return nil }
            let text = SpokenText.from(markdown: reply.text)
            return text.isEmpty ? nil : SpokenReply(id: reply.id, text: text)
        }
    }

    /// Hands-free starts listening only when speech is done, the session is idle and the user asked for it.
    public static func shouldListen(handsFree: Bool, isSpeaking: Bool, status: SessionStatus) -> Bool {
        handsFree && !isSpeaking && status == .idle
    }
}
