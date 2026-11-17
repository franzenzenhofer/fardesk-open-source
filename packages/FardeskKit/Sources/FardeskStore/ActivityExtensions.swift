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
}
