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
    /// Black (the text colour): a session that finished its turn and waits for the next message. Not a colour of its
    /// own, so "your turn" stands out from grey (stopped) without adding a fifth state colour.
    case ready
    /// Grey: stopped, offline, connecting, queued, plain information.
    case inactive
}

extension StateTone {
    /// A working session is green, a waiting one orange, one whose turn ended black, a stopped one grey.
    public init(status: SessionStatus) {
        self = switch status {
        case .working: .ok
        case .waiting: .needsYou
        case .idle: .ready
        case .ended, .unknown: .inactive
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

    /// Sent is green, failed red, the rest grey.
    public init(outbox state: PendingMessage.State) {
        self = switch state {
        case .sent, .delivered: .ok
        case .failed: .broken
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
