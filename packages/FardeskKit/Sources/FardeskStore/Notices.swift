import Foundation

/// Where a notice shows. A session's notices live only in that session's feed; everything else lives at the
/// top of the session list. Nothing floats over the whole app.
public enum NoticeScope: Hashable, Sendable {
    case session(SessionRef)
    case list
}

/// How much a call to a machine reports in context.
public enum CallNotice: Sendable {
    /// Nothing in context; a failure the user caused raises the alert.
    case none
    /// Only a failure, as a line in the session's feed (no alert).
    case failure(SessionRef)
    /// "Ending the session...", then done or failed, in the session's feed (no alert).
    case progress(SessionRef)

    var ref: SessionRef? {
        switch self {
        case .none: nil
        case .failure(let ref), .progress(let ref): ref
        }
    }

    var showsProgress: Bool {
        if case .progress = self { true } else { false }
    }
}

extension AppModel {
    static let noticeLinger: Duration = .seconds(4)

    /// Shows a notice in its scope. Done and info notices go away by themselves; a failure stays until it is
    /// dismissed or its session is left; a running one until the next notice of the same scope replaces it.
    func showNotice(_ notice: ActionFeedback, in scope: NoticeScope) {
        noticeClears[scope]?.cancel()
        notices[scope] = notice
        if notice.state == .failed { failureSignal += 1 }
        guard notice.state == .succeeded || notice.state == .info else { return }
        noticeClears[scope] = Task { [weak self] in
            try? await Task.sleep(for: Self.noticeLinger)
            guard !Task.isCancelled, self?.notices[scope]?.id == notice.id else { return }
            self?.notices[scope] = nil
        }
    }

    /// Says something short on the session list (a tap that cannot do its work must still answer).
    public func tell(_ text: String, failed: Bool) {
        showNotice(ActionFeedback(text: text, state: failed ? .failed : .info), in: .list)
    }

    public func dismissNotice(in scope: NoticeScope) {
        noticeClears[scope]?.cancel()
        notices[scope] = nil
    }

    /// The user left a session: what was said there is over, unless something still runs.
    public func leaveSession(_ ref: SessionRef) {
        if notices[.session(ref)]?.state != .running { dismissNotice(in: .session(ref)) }
        if stepLogs[ref]?.isRunning != true { stepLogs[ref] = nil }
    }
}
