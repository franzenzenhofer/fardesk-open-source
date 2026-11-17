import FardeskModels

/// What a swipe in the session list did with the oldest pending permission request.
public enum ListDecision: Equatable, Sendable {
    case decided
    /// Nothing safe to decide from the list (no pending permission, or allowing needs a confirmation): open the session.
    case openSession
    case failed
}

extension AppModel {
    /// Allows or denies the oldest pending permission request of a session without opening it. The newest page is
    /// loaded first so the request is current. Allowing a destructive request is never done from the list.
    public func decideOldestPending(_ decision: PermissionDecision, in ref: SessionRef) async -> ListDecision {
        await openSession(ref)
        guard let permission = oldestPendingPermission(in: ref) else { return .openSession }
        let action = SessionAction.decide(decision, on: permission)
        if action.requiresConfirmation { return .openSession }
        return await self.decide(decision, requestID: permission.requestId, in: ref) ? .decided : .failed
    }

    private func oldestPendingPermission(in ref: SessionRef) -> PermissionActivity? {
        feeds.feed(for: ref).pendingRequests.lazy.compactMap { activity -> PermissionActivity? in
            if case .permission(let permission) = activity { return permission }
            return nil
        }.first
    }
}
