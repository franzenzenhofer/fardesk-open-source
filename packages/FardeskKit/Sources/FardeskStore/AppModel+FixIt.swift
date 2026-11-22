import FardeskModels
import Foundation

/// "Fix it" (Actions menu, and the card of a chat stuck at the computer): starts a fresh Claude that looks at the stuck
/// session and gets it going again. It runs on the session's own computer; when that computer does not answer, the
/// coordinator on the hub gets the job (it can reach the other computers). Both down: a plain notice, nothing else.
public enum FixItPlan: Equatable, Sendable {
    case onMachine(UUID)
    case onCoordinator(UUID)
    case nowhere

    public static func decide(sessionMachineOnline: Bool, sessionMachine: UUID, hub: UUID?, hubOnline: Bool, coordinatorEnabled: Bool) -> FixItPlan {
        if sessionMachineOnline { return .onMachine(sessionMachine) }
        if let hub, hub != sessionMachine, hubOnline, coordinatorEnabled { return .onCoordinator(hub) }
        return .nowhere
    }

    /// "Fix it: <title of the stuck chat>", within the label length the daemon takes.
    public static func name(for session: SessionSummary) -> String {
        String("Fix it: \(session.displayTitle)".prefix(SessionLabelName.maxLength))
    }

    /// The instruction the fixing Claude gets: which session, what the app sees, what to do, how to report.
    public static func prompt(for session: SessionSummary, machineName: String, remote: Bool) -> String {
        let presentation = SessionPresentation(session: session, now: .now)
        let state = presentation.subtitleParts.joined(separator: ": ")
        let place = remote
            ? "It runs on the computer \"\(machineName)\", which the app cannot reach right now; reach it through your tools."
            : "It runs on this computer."
        return """
        The Claude Code session "\(session.displayTitle)" (session id \(session.id)) in the folder \(session.cwd) looks stuck. \
        \(place) The app shows it as: \(state).
        Find out why it does not go on: its terminal (tmux or Ghostty tab), its process, the last lines of its transcript.
        If a dialog waits in its terminal, say exactly what it asks. Answer it only when the answer is clearly safe and \
        clearly what the user wants; otherwise leave it and say what it needs. If the session hangs, say so and what would \
        end it. Do not change any project files.
        Reply in at most three short lines: what you found, what you did, what the user still has to do.
        """
    }
}

extension AppModel {
    /// Starts the fixing Claude (see `FixItPlan`) and returns the session to open; nil (with a notice) when nothing answers.
    public func fixIt(_ ref: SessionRef) async -> SessionRef? {
        guard let machine = try? state.machine(id: ref.machineID), let session = machine.sessions.first(where: { $0.id == ref.sessionID }) else { return nil }
        let hub = hubMachineID
        let hubOnline = hub.flatMap { try? state.machine(id: $0) }?.isOnline ?? false
        let plan = FixItPlan.decide(sessionMachineOnline: machine.isOnline, sessionMachine: machine.id, hub: hub, hubOnline: hubOnline, coordinatorEnabled: coordinatorEnabled)
        switch plan {
        case .onMachine(let id):
            let prompt = FixItPlan.prompt(for: session, machineName: machine.endpoint.name, remote: false)
            let request = NewSessionRequest(cwd: session.cwd, prompt: prompt, worktree: false, model: nil, permissionMode: nil, home: session.home)
            guard let fixing = await newSession(request, on: id) else { return nil }
            // Named after the chat it fixes, so it is found again in the list (its own title would be the long prompt).
            _ = await label(.rename(FixItPlan.name(for: session)), fixing)
            return fixing
        case .onCoordinator(let hubID):
            let prompt = FixItPlan.prompt(for: session, machineName: machine.endpoint.name, remote: true)
            return await askCoordinator(prompt, on: hubID)
        case .nowhere:
            showNotice(ActionFeedback(text: "Fix it needs \(machine.endpoint.name) or the coordinator, and neither answers right now.", state: .failed), in: .session(ref))
            return nil
        }
    }
}
