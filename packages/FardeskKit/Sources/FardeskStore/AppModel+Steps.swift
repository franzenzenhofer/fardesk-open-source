import FardeskClient
import FardeskModels
import Foundation

/// Actions that start or move a session, with the visible step list in that session's feed.
extension AppModel {
    /// The first request for a feed asks for this many rows only; older rows come when the user scrolls up.
    static let firstPageRows = 50
    /// How every "load the newest rows" step starts: a later load that works drops its failed predecessors.
    static let loadingStepPrefix = "Loading the last"

    // MARK: Step logs

    @discardableResult
    func beginStep(_ ref: SessionRef, _ text: String) -> Int {
        stepLogs[ref, default: StepLog()].begin(text)
    }

    func finishStep(_ ref: SessionRef, _ id: Int, as text: String? = nil) {
        stepLogs[ref]?.finish(id, as: text)
    }

    func failStep(_ ref: SessionRef, _ id: Int, reason: String) {
        stepLogs[ref]?.fail(id, reason: reason)
    }

    /// Takes a step out without a verdict (it was cancelled, nothing to report).
    func dropStep(_ ref: SessionRef, _ id: Int) {
        stepLogs[ref]?.remove(id)
        if stepLogs[ref]?.isEmpty == true { stepLogs[ref] = nil }
    }

    /// The first row of a session proves "Waiting for the first answer..." is over.
    func rowsArrived(for ref: SessionRef) {
        guard stepLogs[ref]?.isRunning == true else { return }
        stepLogs[ref]?.finishRunning()
    }

    public func dismissLog(for ref: SessionRef) {
        stepLogs[ref] = nil
    }

    // MARK: Starting and moving sessions

    /// "Resume" and the like: the steps show on the session you are in, then the new session opens.
    public func resume(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "resume the session", intro: "Resuming the session") { try await $0.resume(sessionID: id) }.get()
    }

    public func takeover(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "take over the session", intro: "Taking over the session") { try await $0.takeover(sessionID: id) }.get()
    }

    /// Starts a fresh conversation (`/clear`); the result is the session to open.
    public func clear(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "clear the session", intro: "Clearing the context") { try await $0.clear(sessionID: id) }.get()
    }

    public func fork(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "fork the session", intro: "Forking the session") { try await $0.fork(sessionID: id) }.get()
    }

    public func newSession(_ request: NewSessionRequest, on machineID: UUID) async -> SessionRef? {
        let origin = SessionRef.starting(on: machineID)
        return try? await runStart(origin: origin, action: "start the session", intro: "Starting Claude") { try await $0.newSession(request) }.get()
    }

    /// Opens the session screen at once and starts the session behind it: the returned placeholder
    /// shows the steps, and `startedSessions[placeholder]` names the real session when it exists.
    public func startNewSession(_ request: NewSessionRequest, on machineID: UUID) -> SessionRef {
        let origin = SessionRef.starting(on: machineID)
        let step = beginStep(origin, "Starting Claude on \(machineName(machineID))...")
        Task {
            let result = try? await runStart(origin: origin, action: "start the session", intro: "Starting Claude", step: step) { try await $0.newSession(request) }.get()
            if let result { startedSessions[origin] = result }
        }
        return origin
    }

    /// One call that answers with a session id: step "<intro> on <machine>...", then "Session started
    /// (abc123)", then "Waiting for the first answer..." which ends when the first row arrives.
    func runStart(
        origin: SessionRef,
        action: String,
        intro: String,
        step existing: Int? = nil,
        _ call: (any FardeskService) async throws -> ActionResult
    ) async -> Result<SessionRef, any Error> {
        let machine = machineName(origin.machineID)
        let step = existing ?? beginStep(origin, "\(intro) on \(machine)...")
        let started = Date()
        do {
            guard let endpoint = machines.endpoints.first(where: { $0.id == origin.machineID }) else {
                throw AppStateError.unknownMachine(origin.machineID)
            }
            let result = try await call(service(for: endpoint))
            let real = SessionRef(machineID: origin.machineID, sessionID: result.sessionId)
            finishStep(origin, step, as: "Session started (\(result.sessionId.prefix(6)))")
            var log = stepLogs[origin] ?? StepLog()
            log.begin("Waiting for the first answer...")
            stepLogs[real] = log
            recordEvent("action", "\(action): done", machineID: origin.machineID, since: started)
            return .success(real)
        } catch {
            failStep(origin, step, reason: ErrorText.detail(error))
            recordEvent("action", "\(action): failed (\(error.telemetryCode))", machineID: origin.machineID, since: started)
            failureSignal += 1
            handleFailure(error, machineID: origin.machineID, action: action, origin: .background)
            return .failure(error)
        }
    }
}
