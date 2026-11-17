import Foundation

/// The words and rules of the Coordinator entry points: the pinned row, the empty state and the
/// "Describe it" field of the New Session sheet.
public enum CoordinatorPresentation {
    public static let title = "Coordinator"
    public static let symbol = "point.3.connected.trianglepath.dotted"
    public static let emptyStateText =
        "Claude Code with every tool and no permission prompts, on your hub. It starts, checks, answers, clears and ends sessions on all your machines, finds old ones, runs commands itself and pings your phone."
    public static let suggestions = ["What needs me?", "Why is a session waiting?", "Find an old session", "Start a session in a project"]

    public static let describeTitle = "Describe it"
    public static let describePlaceholder = "e.g. crawler on Linux, new worktree, fix the redirect tests"
    public static let describeButton = "Ask Coordinator"
    private static let newSessionPrefix = "Start a new Claude session: "

    /// The line under the screen title: "Coordinator · <machine>".
    public static func screenSubtitle(machine: String) -> String {
        "\(title) \u{00B7} \(machine)"
    }

    /// Shown instead of the composer while the machine's Coordinator is switched off.
    public static func offText(machineName: String) -> String {
        "The Coordinator is off on \(machineName). It can run commands and answer for your sessions, so it starts only when you turn it on: set coordinator.enabled to true in that machine's config.json and restart fardeskd."
    }

    /// The text sent from the New Session sheet, or nil when the field is blank.
    public static func newSessionPrompt(describing text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : newSessionPrefix + trimmed
    }

    /// The machine the Coordinator opens on: the hub itself, else the first online machine, else the first listed (the screen always opens).
    public static func defaultMachine(in machines: [MachineState]) -> MachineState? {
        machines.first { $0.hubInfo?.hub == true } ?? machines.first(where: \.isOnline) ?? machines.first
    }
}

extension SessionRef {
    /// Stands for "the coordinator session of this machine, not started yet". It is the list
    /// selection of the Coordinator row; the empty-state screen replaces it with the real session.
    public static func pendingCoordinator(on machineID: UUID) -> SessionRef {
        SessionRef(machineID: machineID, sessionID: "")
    }

    public var isPendingCoordinator: Bool { sessionID.isEmpty }
}
