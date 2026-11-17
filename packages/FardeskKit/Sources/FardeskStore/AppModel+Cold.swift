import FardeskClient
import FardeskModels
import Foundation

/// A session waiting for the user to choose how to continue it. `messageID` is the held message in the outbox, if any.
public struct ColdHold: Equatable, Sendable {
    public let messageID: UUID?
}

/// Cold sessions: before a message goes to (or a resume restarts) a session whose prompt cache is cold and
/// that is long, the app asks Resume / Resume from summary / Start new (the dialog Claude Code shows).
extension AppModel {
    func isCold(_ ref: SessionRef) -> Bool {
        guard let session = try? state.machine(id: ref.machineID).sessions.first(where: { $0.id == ref.sessionID }) else { return false }
        return configuration.treatsEverySessionAsCold || ColdSession.isCold(session, now: Date())
    }

    func session(_ ref: SessionRef) -> SessionSummary? {
        (try? state.machine(id: ref.machineID))?.sessions.first { $0.id == ref.sessionID }
    }

    /// The warning sentence for the card of a held session.
    public func coldWarning(for ref: SessionRef) -> String? {
        session(ref).map { ColdSession.warning($0, now: Date()) }
    }

    /// The buttons of the card of a held session.
    public func coldChoices(for ref: SessionRef) -> [ColdChoice] {
        guard let session = session(ref), let hold = coldHolds[ref] else { return [] }
        return ColdSession.choices(for: session, hasMessage: hold.messageID != nil)
    }

    /// Resume button / menu: a cold session asks first; the result is the session to open (nil while the card waits).
    public func beginResume(_ ref: SessionRef) async -> SessionRef? {
        guard isCold(ref) else { return await resume(ref) }
        coldHolds[ref] = ColdHold(messageID: nil)
        return nil
    }

    /// Holds a message back until the user chose; it shows in the feed as "Waiting for your choice".
    func hold(_ id: UUID, for ref: SessionRef) {
        outbox.set(id, .held)
        coldHolds[ref] = ColdHold(messageID: id)
    }

    /// Carries out the user's choice. The result is the session to open, when it is a different one.
    @discardableResult
    public func chooseCold(_ choice: ColdChoice, for ref: SessionRef) async -> SessionRef? {
        guard let hold = coldHolds[ref], let session = session(ref) else { return nil }
        coldHolds[ref] = nil
        recordEvent("cold", "chose \(choice.rawValue) (\(session.contextTokens.map(ColdSession.tokensLabel) ?? "?") tokens)", machineID: ref.machineID, sessionID: ref.sessionID)
        switch ColdSession.action(for: choice, session: session) {
        case .sendAsIs: return await continueAsIs(ref, hold: hold)
        case .compactThenSend: return await continueAfter(ref, hold: hold) { await compact($0) }
        case .clearThenSend: return await continueAfter(ref, hold: hold) { await clear($0) }
        case .newSessionWithPrompt: return startFresh(from: session, on: ref, hold: hold)
        }
    }

    /// "Resume": send the held message; with no message the session is resumed.
    private func continueAsIs(_ ref: SessionRef, hold: ColdHold) async -> SessionRef? {
        guard let id = hold.messageID else { return await resume(ref) }
        outbox.set(id, .queued(waitingFor: nil))
        await deliver(id)
        return nil
    }

    /// "Resume from summary" / clear: run the action, then send the message to the session that results.
    private func continueAfter(_ ref: SessionRef, hold: ColdHold, _ action: (SessionRef) async -> SessionRef?) async -> SessionRef? {
        guard let next = await action(ref) else {
            if let id = hold.messageID { outbox.set(id, .failed("the session could not be prepared")) }
            return nil
        }
        if let id = hold.messageID {
            outbox.move(id, to: next)
            outbox.set(id, .queued(waitingFor: nil))
            Task { await deliver(id) }
        }
        return next
    }

    /// An ended session cannot be cleared: a new one starts in the same folder and mode with the message as its first prompt.
    private func startFresh(from session: SessionSummary, on ref: SessionRef, hold: ColdHold) -> SessionRef? {
        guard let id = hold.messageID, let message = outbox.message(id) else { return nil }
        outbox.remove(id)
        let request = NewSessionRequest(
            cwd: session.cwd, prompt: message.text, worktree: false, model: nil, permissionMode: session.permissionMode
        )
        return startNewSession(request, on: ref.machineID)
    }

    /// Asks Claude to write a summary and continue from it.
    public func compact(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "compact the session", intro: "Writing a summary") { try await $0.compact(sessionID: id) }.get()
    }

    /// The user closes the card without choosing: the held message is dropped from the feed.
    public func cancelCold(for ref: SessionRef) {
        if let id = coldHolds[ref]?.messageID { outbox.remove(id) }
        coldHolds[ref] = nil
    }
}
