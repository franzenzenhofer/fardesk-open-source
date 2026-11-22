import FardeskModels

/// What a chat shows for "needs you" when no request card is in its feed (docs/design/STATES.md, Attention).
/// Rule: a session the list counts as "needs you" always opens on something to act on. Request cards (approve,
/// answer, answer at the computer) come from the feed; this covers every waiting session without one.
public enum AttentionCard: Equatable, Sendable {
    /// A dialog is open in the terminal that no request reached the phone for (the daemon only sees Claude's own
    /// "waiting" state): name it and say where to answer it.
    case atComputer(dialog: String)
    /// An approval or a question is waiting but its card has not arrived yet: say so and load it again.
    case loadingRequest(String)

    /// The card to show, or nil when the session does not wait or the feed already shows a request card.
    public static func resolve(session: SessionSummary, feedShowsRequest: Bool) -> AttentionCard? {
        guard session.status == .waiting, !feedShowsRequest else { return nil }
        switch session.waitingFor {
        case .permission?: return .loadingRequest("Loading the approval it waits for...")
        case .question?: return .loadingRequest("Loading the question it waits for...")
        case .dialog?: return .loadingRequest("Loading what Claude Code asks...")
        case .terminal?, .unknown?, nil:
            let dialog = SessionPresentation.detail(of: session)
            return .atComputer(dialog: dialog.isEmpty ? "A question is open in its terminal." : dialog)
        }
    }
}
