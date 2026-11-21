import FardeskClient
import FardeskModels
import Foundation

/// Optimistic sending: the message is in the feed the moment it is tapped, and its state updates in place.
extension AppModel {
    /// What `submit` did with the composer's message.
    public enum SubmitResult: Equatable, Sendable {
        case failed
        case sent
        /// `/clear` ran: open this session.
        case cleared(SessionRef)
    }

    /// Queues the message (it shows at once), then sends it in the background. `/clear` alone runs the clear route.
    public func submit(_ message: OutgoingMessage, to ref: SessionRef) async -> SubmitResult {
        guard !message.isClearCommand else { return await clear(ref).map(SubmitResult.cleared) ?? .failed }
        guard !message.isCompactCommand else { return await compact(ref).map(SubmitResult.cleared) ?? .failed }
        if isCold(ref) { cancelCold(for: ref) }
        let id = outbox.add(message, to: ref, kind: .reply, at: Date(), knownRows: userRowIDs(in: ref))
        sendSignal += 1
        if isCold(ref) {
            hold(id, for: ref)
            return .sent
        }
        Task { await deliver(id) }
        return .sent
    }

    /// The coordinator's first message: it shows in the empty Coordinator screen and starts its session.
    public func askCoordinatorQueued(_ prompt: String, on machineID: UUID) {
        let ref = SessionRef.pendingCoordinator(on: machineID)
        let id = outbox.add(OutgoingMessage(text: prompt), to: ref, kind: .coordinator, at: Date())
        sendSignal += 1
        Task { await deliver(id) }
    }

    /// Sends a message that was queued or failed again.
    public func retry(_ id: UUID) {
        guard outbox.message(id)?.canRetry == true else { return }
        outbox.set(id, .queued(waitingFor: nil))
        Task { await deliver(id) }
    }

    public func discard(_ id: UUID) {
        outbox.remove(id)
    }

    /// Sends every message queued for a machine (it came back online).
    func flushOutbox(on machineID: UUID) async {
        for pending in outbox.queued(on: machineID) { await deliver(pending.id) }
    }

    /// Shown under a message held while its session waits on a permission or question the phone can answer: typed
    /// into the open dialog it would answer it and lose its attachment lines.
    static let waitingForAnswer = "your answer"

    /// True while the session waits on a request the phone can answer. A question open only at the computer is not
    /// one: nothing on the phone ends that wait, so a message is never held for it (the daemon refuses it with the reason).
    func awaitsPhoneAnswer(_ ref: SessionRef) -> Bool {
        guard let session = session(ref), session.status == .waiting else { return false }
        return session.waitingFor?.phoneCanAnswer ?? false
    }

    /// Sends every held message whose session no longer waits on an answer from the phone (called after each state change).
    func releaseAnswerHolds() {
        for pending in outbox.messages where pending.state == .queued(waitingFor: Self.waitingForAnswer) {
            guard !awaitsPhoneAnswer(pending.ref) else { continue }
            Task { await deliver(pending.id) }
        }
    }

    func deliver(_ id: UUID) async {
        guard let pending = outbox.message(id), !pending.isInFlight else { return }
        if pending.kind == .reply, awaitsPhoneAnswer(pending.ref) {
            return outbox.set(id, .queued(waitingFor: Self.waitingForAnswer))
        }
        let started = Date()
        outbox.set(id, .sending)
        do {
            let target = try await transmit(pending)
            if let target { outbox.move(id, to: target) }
            outbox.set(id, .sent)
            recordEvent("action", "send the message: done", machineID: pending.ref.machineID, since: started)
        } catch {
            let machine = machineName(pending.ref.machineID)
            let waits = error.isTransport || error.machineOfflineMessage != nil
            outbox.set(id, waits ? .queued(waitingFor: machine) : .failed(ErrorText.detail(error)))
            recordEvent("action", "send the message: failed (\(error.telemetryCode))", machineID: pending.ref.machineID, since: started)
            handleFailure(error, machineID: pending.ref.machineID, action: "send the message", origin: .background)
        }
    }

    /// Does the HTTP work. A coordinator message answers with the session it started.
    private func transmit(_ pending: PendingMessage) async throws -> SessionRef? {
        switch pending.kind {
        case .reply:
            guard let endpoint = machines.endpoints.first(where: { $0.id == pending.ref.machineID }) else {
                throw AppStateError.unknownMachine(pending.ref.machineID)
            }
            _ = try await upload(pending.message, with: access.api(for: endpoint), to: pending.ref.sessionID)
            return nil
        case .coordinator:
            let real = try await runStart(
                origin: pending.ref, action: "ask the coordinator", intro: "Starting the coordinator"
            ) { try await $0.askCoordinator(prompt: pending.text) }.get()
            startedSessions[pending.ref] = real
            setCoordinatorSession(real.sessionID)
            return real
        }
    }

    /// The ids of the user rows a session's feed shows right now.
    func userRowIDs(in ref: SessionRef) -> Set<String> {
        Set(feeds.feed(for: ref).activities.compactMap { row -> String? in
            if case .user(let user) = row { user.id } else { nil }
        })
    }

    /// A user row that repeats a message in flight is that message arriving; it is shown once, as "Claude got it".
    func reconcileOutbox(_ ref: SessionRef) {
        Breadcrumbs.mark("reconcile outbox")
        defer { Breadcrumbs.mark("idle") }
        guard !outbox.pending(for: ref).isEmpty else { return }
        outbox.reconcile(ref, rows: feeds.feed(for: ref).activities)
    }
}
