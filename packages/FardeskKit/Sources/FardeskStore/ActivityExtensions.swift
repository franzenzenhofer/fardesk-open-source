import FardeskModels
import Foundation

extension Activity {
    public var timestamp: Date {
        switch self {
        case .user(let a): a.ts
        case .assistant(let a): a.ts
        case .tool(let a): a.ts
        case .files(let a): a.ts
        case .question(let a): a.ts
        case .permission(let a): a.ts
        case .system(let a): a.ts
        }
    }

    /// A permission or question still waiting for the human. These render as the sticky card.
    public var isPendingRequest: Bool {
        switch self {
        case .permission(let a): a.state == .pending
        case .question(let a): a.state == .pending
        default: false
        }
    }

    /// A permission or question the phone was not asked in time: its dialog waits at the computer. It stays in the
    /// session as a card that names what it asks (and answers it by typing when the daemon says it can).
    public var isTerminalRequest: Bool {
        switch self {
        case .permission(let a): a.state == .terminal
        case .question(let a): a.state == .terminal
        default: false
        }
    }
}
