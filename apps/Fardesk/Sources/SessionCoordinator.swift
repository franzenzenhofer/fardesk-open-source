import FardeskStore
import Foundation
import Observation

/// Where the detail column is. The Coordinator is a route of its own: opening it never turns into a session.
enum Route: Hashable {
    case session(SessionRef)
    case coordinator
    /// A session being started (the ref is its placeholder, see `SessionRef.starting`).
    case starting(SessionRef)
}

/// UI state shared by the list, the session screen and the notification handlers:
/// which screen is open and which destructive action waits for a confirmation.
@MainActor
@Observable
final class SessionCoordinator {
    var route: Route?
    /// A session waiting for the End Session confirmation.
    var killTarget: SessionRef?
    /// A session waiting for the Rename prompt.
    var renameTarget: SessionRef?
    /// A session whose full colour picker ("More colours") is open.
    var colourTarget: SessionRef?
    var terminalTarget: SessionRef?
    var showsNewSession = false
    /// What the New Session sheet starts with ("Start fresh here" fills it from the stopped chat); nil = empty.
    var newSessionPreset: NewSessionDraft?
    var showsSettings = false

    /// The open session (or the one being started), as most callers think of it.
    var selection: SessionRef? {
        get {
            switch route {
            case .session(let ref), .starting(let ref): ref
            case .coordinator, nil: nil
            }
        }
        set {
            guard let newValue else { return route = nil }
            route = newValue.isStarting ? .starting(newValue) : .session(newValue)
        }
    }

    func reset() {
        route = nil
        killTarget = nil
        renameTarget = nil
        colourTarget = nil
        terminalTarget = nil
        showsNewSession = false
        newSessionPreset = nil
        showsSettings = false
    }
}
