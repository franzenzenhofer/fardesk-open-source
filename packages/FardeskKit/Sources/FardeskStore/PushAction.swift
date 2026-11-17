import FardeskModels
import Foundation

/// The session a push notification is about, as the daemon puts it into `userInfo`.
public struct PushTarget: Equatable, Sendable {
    public let machine: String
    public let sessionID: String
    public let requestID: String?

    public init(machine: String, sessionID: String, requestID: String?) {
        self.machine = machine
        self.sessionID = sessionID
        self.requestID = requestID
    }
}

/// What a tapped notification, one of its actions or a silent push asks the app to do.
public enum PushAction: Equatable, Sendable {
    case open(PushTarget)
    case decide(PermissionDecision, PushTarget)
    case reply(String, PushTarget)
    case answer(String, PushTarget)
    case wipe

    public static let defaultActionIdentifier = "com.apple.UNNotificationDefaultActionIdentifier"
    public static let allowIdentifier = "ALLOW"
    public static let denyIdentifier = "DENY"
    public static let replyIdentifier = "REPLY"
    public static let openIdentifier = "OPEN"

    private static let wipeCommand = "wipe"

    /// Maps a notification response (or a silent push with any identifier) to an action.
    /// Nil when the payload misses what the action needs.
    public static func parse(actionIdentifier: String, userInfo: [String: String], text: String?) -> PushAction? {
        if userInfo["command"] == wipeCommand { return .wipe }
        guard let machine = userInfo["machine"], let sessionID = userInfo["sessionId"] else { return nil }
        let target = PushTarget(machine: machine, sessionID: sessionID, requestID: userInfo["requestId"])
        switch actionIdentifier {
        case allowIdentifier: return target.requestID == nil ? nil : .decide(.allow, target)
        case denyIdentifier: return target.requestID == nil ? nil : .decide(.deny, target)
        case replyIdentifier: return reply(text, target)
        case defaultActionIdentifier, openIdentifier: return .open(target)
        default: return nil
        }
    }

    /// A reply to a question push answers the request; a reply to a done push is a new message.
    private static func reply(_ text: String?, _ target: PushTarget) -> PushAction? {
        guard let text, !text.isEmpty else { return nil }
        return target.requestID == nil ? .reply(text, target) : .answer(text, target)
    }
}
