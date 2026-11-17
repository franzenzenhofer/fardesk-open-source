import FardeskModels

/// The four state colours of the app, as meaning (docs/design/COLOUR-CODING.md). The app maps each to one
/// colour in `StateColor`; nothing else in the app may colour a state. Blue is never a state colour.
public enum StateTone: Equatable, Sendable {
    /// Red: broken, error, failed, or an action that breaks something (End session, Revoke).
    case broken
    /// Orange: waiting on the human (permission, question, a choice, logging in again).
    case needsYou
    /// Green: online, OK, working fine, live.
    case ok
    /// Grey: idle, ended, offline, connecting, queued, plain information.
    case inactive
}

extension StateTone {
    /// A working session is green, a waiting one orange, an idle or ended one grey.
    public init(status: SessionStatus) {
        self = switch status {
        case .working: .ok
        case .waiting: .needsYou
        case .idle, .ended: .inactive
        }
    }

    /// Online is green; a machine that refused the token needs a new login (orange); the rest is grey.
    public init(connection: ConnectionState) {
        self = switch connection {
        case .online: .ok
        case .loggedOut: .needsYou
        case .connecting, .offline: .inactive
        }
    }

    /// A hub that does not answer breaks the whole app (red); connecting is grey; reachable shows nothing (green).
    public init(hub: HubStatus) {
        self = switch hub {
        case .reachable: .ok
        case .connecting: .inactive
        case .unreachable: .broken
        }
    }

    /// Sent is green, failed red, a held message waits for the user's choice (orange), the rest grey.
    public init(outbox state: PendingMessage.State) {
        self = switch state {
        case .sent: .ok
        case .failed: .broken
        case .held: .needsYou
        case .queued, .sending: .inactive
        }
    }

    public init(notice state: ActionFeedback.State) {
        self = switch state {
        case .succeeded: .ok
        case .failed: .broken
        case .running, .info: .inactive
        }
    }

    public init(step state: StepLog.State) {
        self = switch state {
        case .done: .ok
        case .failed: .broken
        case .running: .inactive
        }
    }
}

extension SessionHeaderLine.Tone {
    /// The state colour of the status word under the session title.
    public var state: StateTone {
        switch self {
        case .working: .ok
        case .attention: .needsYou
        case .quiet: .inactive
        }
    }
}
