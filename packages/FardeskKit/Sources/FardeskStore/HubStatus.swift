import Foundation

/// How the hub answers right now: the line at the top of the Machines screen.
public enum HubStatus: Equatable, Sendable {
    /// The first poll is running.
    case connecting
    case reachable
    case unreachable(reason: String)

    /// The one line to show, or nil when everything is fine. Never empty words for a bad state.
    public func bannerText(hubName: String, address: String) -> String? {
        switch self {
        case .connecting: "Connecting to the hub (\(hubName))..."
        case .reachable: nil
        case .unreachable(let reason): "Can't reach the hub (\(hubName), \(address)): \(reason). Retrying..."
        }
    }

    public var showsSpinner: Bool { self != .reachable && !isUnreachable }

    public var isUnreachable: Bool {
        if case .unreachable = self { true } else { false }
    }
}

/// A short status for the action that is running or just ended, shown over the screen.
public struct ActionFeedback: Equatable, Sendable, Identifiable {
    public enum State: Equatable, Sendable {
        case running, succeeded, failed, info
    }

    public let id: UUID
    public let text: String
    public let state: State

    public init(id: UUID = UUID(), text: String, state: State) {
        self.id = id
        self.text = text
        self.state = state
    }

    private static func sentence(_ action: String, machine: String) -> String {
        action.prefix(1).uppercased() + action.dropFirst() + " on \(machine)"
    }

    public static func running(_ action: String, machine: String) -> ActionFeedback {
        ActionFeedback(text: sentence(action, machine: machine) + "...", state: .running)
    }

    public static func succeeded(_ action: String, machine: String) -> ActionFeedback {
        ActionFeedback(text: sentence(action, machine: machine) + ": done", state: .succeeded)
    }

    public static func failed(_ action: String, machine: String, reason: String) -> ActionFeedback {
        ActionFeedback(text: "Could not \(action) on \(machine): \(reason)", state: .failed)
    }
}
