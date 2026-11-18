import FardeskClient
import FardeskModels
import Foundation

extension AppModel {
    /// Runs one call against a machine. A failure goes through `handleFailure` (a revoked token
    /// wipes everything, a cancelled call is silent) and the result is nil. With a session `notice` the
    /// failure is a line in that session's feed; without one a failure the user caused is an alert.
    func perform<Result>(
        on machineID: UUID,
        action: String,
        origin: CallOrigin = .user,
        notice: CallNotice = .none,
        _ call: (FardeskAPI) async throws -> Result
    ) async -> Result? {
        let started = Date()
        let machine = machineName(machineID)
        let scope = notice.ref.map(NoticeScope.session)
        if notice.showsProgress, let scope { showNotice(.running(action, machine: machine), in: scope) }
        do {
            guard let endpoint = machines.endpoints.first(where: { $0.id == machineID }) else {
                throw AppStateError.unknownMachine(machineID)
            }
            let result = try await call(access.api(for: endpoint))
            if notice.showsProgress, let scope {
                recordEvent("action", "\(action): done", machineID: machineID, since: started)
                showNotice(.succeeded(action, machine: machine), in: scope)
            }
            return result
        } catch {
            if let scope {
                recordEvent("action", "\(action): failed (\(error.telemetryCode))", machineID: machineID, since: started)
                showNotice(.failed(action, machine: machine, reason: ErrorText.detail(error)), in: scope)
            }
            handleFailure(error, machineID: machineID, action: action, origin: scope == nil ? origin : .background)
            return nil
        }
    }

    // MARK: Feed

    /// Shows the cached rows of a session at once, then folds the newest page from the machine into them.
    public func openSession(_ ref: SessionRef) async {
        let id = ref.sessionID
        let opened = Date()
        await restoreCachedFeed(ref)
        let hasCache = !feeds.feed(for: ref).activities.isEmpty
        if hasCache { recordEvent("session.open", "cache hit, content shown", machineID: ref.machineID, sessionID: id, since: opened) }
        let step = hasCache ? nil : beginStep(ref, "\(Self.loadingStepPrefix) \(Self.firstPageRows) rows from \(machineName(ref.machineID))...")
        guard let page = await perform(
            on: ref.machineID, action: "load activity", origin: .background,
            { try await $0.activity(sessionID: id, limit: Self.firstPageRows) }
        ) else {
            // A cancelled open (the screen went away or opened again) is no failure: the next open says what happens.
            if let step { Task.isCancelled ? dropStep(ref, step) : failStep(ref, step, reason: "the machine did not answer") }
            return
        }
        if let step { finishStep(ref, step, as: "Loaded \(page.items.count) rows") }
        stepLogs[ref]?.dropFailures(matching: Self.loadingStepPrefix)
        refreshFeed(with: page, of: ref)
        recordEvent("session.open", hasCache ? "cache hit, refreshed" : "cache miss, content shown", machineID: ref.machineID, sessionID: id, since: opened)
    }

    /// Loads the next older page, when there is one.
    public func loadOlder(_ ref: SessionRef) async {
        let id = ref.sessionID
        guard let cursor = feeds.feed(for: ref).nextBefore else { return }
        guard let page = await perform(
            on: ref.machineID, action: "load older activity", notice: .failure(ref), { try await $0.activity(sessionID: id, before: cursor) }
        ) else { return }
        prepend(page, to: ref)
    }

    public func detail(activityID: String, in ref: SessionRef) async -> ActivityDetail? {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: "load the details", notice: .failure(ref)) {
            try await $0.detail(sessionID: id, activityID: activityID)
        }
    }

    public func recentFolders(on machineID: UUID) async -> RecentFolders? {
        await perform(on: machineID, action: "list the recent folders") { try await $0.recentFolders() }
    }

    private func prepend(_ page: ActivityPage, to ref: SessionRef) {
        feeds.prepend(page: page, to: ref)
    }

    // MARK: Session actions (true = the machine accepted it)

    @discardableResult
    public func send(_ text: String, to ref: SessionRef) async -> Bool {
        await send(OutgoingMessage(text: text), to: ref)
    }

    /// Uploads the attachments to the session's machine, then sends the text with their ids.
    @discardableResult
    public func send(_ message: OutgoingMessage, to ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        let action = message.attachments.isEmpty ? "send the message" : "send the message with its attachments"
        return await perform(on: ref.machineID, action: action, notice: .failure(ref)) { try await upload(message, with: $0, to: id) } != nil
    }

    /// Uploads the attachments, then sends the text with their ids.
    func upload(_ message: OutgoingMessage, with api: FardeskAPI, to sessionID: String) async throws -> MessageResult {
        var ids: [String] = []
        for attachment in message.attachments {
            let stored = try await api.uploadAttachment(
                sessionID: sessionID, data: try attachment.bytes(), mediaType: attachment.mediaType, filename: attachment.filename
            )
            ids.append(stored.attachmentId)
        }
        return try await api.message(sessionID: sessionID, text: message.textToSend, attachments: ids.isEmpty ? nil : ids)
    }

    @discardableResult
    public func decide(_ decision: PermissionDecision, requestID: String, in ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: "answer the permission request", notice: .failure(ref)) {
            try await $0.decide(sessionID: id, requestID: requestID, decision: decision)
        } != nil
    }

    @discardableResult
    public func answer(_ option: String, requestID: String, in ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: "answer the question", notice: .failure(ref)) {
            try await $0.answer(sessionID: id, requestID: requestID, option: option)
        } != nil
    }

    @discardableResult
    public func stop(_ ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: "stop the session", notice: .progress(ref)) { try await $0.stop(sessionID: id) } != nil
    }

    @discardableResult
    public func kill(_ ref: SessionRef, closeTab: Bool = false) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: "end the session", notice: .progress(ref)) {
            try await $0.kill(sessionID: id, closeTab: closeTab)
        } != nil
    }

    @discardableResult
    public func mute(_ muted: Bool, _ ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: muted ? "mute the session" : "unmute the session", notice: .failure(ref)) {
            try await $0.mute(sessionID: id, muted: muted)
        } != nil
    }

    /// Rename, colour or pin a session (docs/design/SESSION-LABELS.md). The daemon pushes the new list right after.
    @discardableResult
    public func label(_ request: LabelRequest, _ ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        return await perform(on: ref.machineID, action: Self.labelAction(request), notice: .failure(ref)) {
            try await $0.label(sessionID: id, request)
        } != nil
    }

    static func labelAction(_ request: LabelRequest) -> String {
        if let pinned = request.pinned { return pinned ? "pin the session" : "unpin the session" }
        if request.color != nil { return "change the colour" }
        return "rename the session"
    }

}
