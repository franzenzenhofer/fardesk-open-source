import Foundation

public enum DialogState: String, TolerantEnum {
    case pending, answered, expired, unknown
}

/// A dialog Claude Code itself asks (feature `claude-dialogs`), for example "Resume this conversation?". The app
/// shows it and sends back one of `choices`; it never decides anything on its own. The payload is opaque: its keys
/// depend on `dialogKind`, and a shape this build does not know never fails decoding.
public struct DialogActivity: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let ts: Date
    public let requestId: String
    public let dialogKind: String
    public let payload: [String: JSONValue]
    public let choices: [String]
    /// Absent while the dialog is listed as open; the daemon leaves answered and expired ones out of the open list.
    public let state: DialogState?

    private enum CodingKeys: String, CodingKey {
        case id, ts, requestId, dialogKind, payload, choices, state
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try c.decode(String.self, forKey: .requestId)
        dialogKind = try c.decode(String.self, forKey: .dialogKind)
        id = try c.decode(String.self, forKey: .id)
        ts = try c.decode(Date.self, forKey: .ts)
        payload = (try? c.decode([String: JSONValue].self, forKey: .payload)) ?? [:]
        choices = (try? c.decode([String].self, forKey: .choices)) ?? []
        state = try c.decodeIfPresent(DialogState.self, forKey: .state)
    }

    public var isPending: Bool { state == nil || state == .pending }
}

/// Body of `POST /v1/sessions/:id/dialog/:requestId`: one of the dialog's `choices`.
public struct DialogAnswerRequest: Codable, Sendable, Hashable {
    public let answer: String

    public init(answer: String) {
        self.answer = answer
    }
}
