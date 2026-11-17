import FardeskClient
import FardeskModels
import FardeskStore

/// What a one-line confirmation says happened.
public enum ConfirmedAction: Sendable, Equatable {
    case sent
    /// The session was busy: it reads the message after its current turn.
    case queued
    case stopped
    case killed(closed: ClosedSurface)
    case decided(PermissionDecision)
    case answered(String)
}

/// Confirmations for commands that change something. `--json` prints the contract `OkResult`.
public enum ActionRenderer {
    private struct Started: Encodable {
        let machine: String
        let sessionId: String
    }

    public static func render(_ action: ConfirmedAction, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try json(action)
        case .human: text(action)
        }
    }

    /// `resume`, `takeover`, `fork` and `new` answer with the session to continue in.
    public static func renderStarted(_ result: ActionResult, machine: String, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(Started(machine: machine, sessionId: result.sessionId))
        case .human: "Session \(ShortID.short(result.sessionId)) on \(machine)"
        }
    }

    /// `coordinator` names the machine and the coordinator session it talks to.
    public static func renderCoordinator(_ sessionID: String, machine: String, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(Started(machine: machine, sessionId: sessionID))
        case .human: "Coordinator on \(machine): \(ShortID.short(sessionID))"
        }
    }

    private static func json(_ action: ConfirmedAction) throws -> String {
        if action == .queued { return try JSONOutput.compact(MessageResult(queued: true)) }
        if case .killed(let closed) = action { return try JSONOutput.compact(KillResult(closed: closed)) }
        return try JSONOutput.compact(OkLiteral())
    }

    private static func text(_ action: ConfirmedAction) -> String {
        switch action {
        case .sent: "Sent"
        case .queued: "Queued: Claude is busy, it will read this after the current turn"
        case .stopped: "Stopped"
        case .killed(let closed): closed == .none ? "Killed" : "Killed\nclosed \(closed.rawValue)"
        case .decided(.deny): "Denied"
        case .decided(.allow): "Allowed"
        case .decided(.allowAlways): "Allowed, and always for this kind"
        case .answered(let option): "Answered: \(option)"
        }
    }
}

private struct OkLiteral: Encodable {
    let ok = true
}

/// Any failure as the contract error body: the daemon's own for server errors, `internal` otherwise.
extension ErrorRenderer {
    public static func render(_ error: any Error, machine: String?, options: RenderOptions) throws -> String {
        let prefix = machine.map { "\($0): " } ?? ""
        if error.isLocalSentence {
            let code: ErrorCode = error.isUserMistake ? .invalidRequest : .internal
            if options.format == .human { return "error: " + prefix + error.localizedDescription }
            return try render(ErrorResponse(error: ErrorBody(code: code, message: prefix + error.localizedDescription)), options: options)
        }
        var body = ErrorBody(code: .internal, message: error.localizedDescription)
        if case .server(_, let response)? = error as? FardeskAPIError { body = response.error }
        return try render(
            ErrorResponse(error: ErrorBody(code: body.code, message: prefix + body.message)),
            options: options
        )
    }
}
