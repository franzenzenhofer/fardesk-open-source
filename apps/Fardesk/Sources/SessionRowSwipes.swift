import FardeskModels
import FardeskStore
import SwiftUI

/// The swipes of a session row. Right swipe (WhatsApp style) unblocks: Allow on a permission, Answer on a question,
/// Open otherwise, then Pin / Unpin. Left swipe on a permission row starts with Deny, then Stop / End Session.
struct SessionRowSwipes: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let session: SessionSummary

    private var waitsForPermission: Bool { session.status == .waiting && session.waitingFor == .permission }
    private var waitsForQuestion: Bool { session.status == .waiting && session.waitingFor == .question }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing) {
                if waitsForPermission {
                    Button("Deny", systemImage: "xmark.circle") { decide(.deny) }
                        .tint(StateColor.broken)
                        .accessibilityIdentifier("swipe-deny-\(session.id)")
                }
                StopKillButtons(ref: ref, session: session)
            }
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                leadingButton
                PinButton(ref: ref, session: session).tint(.indigo)
            }
    }

    @ViewBuilder
    private var leadingButton: some View {
        if waitsForPermission {
            Button("Allow", systemImage: "checkmark.circle") { decide(.allow) }
                .tint(StateColor.ok)
                .accessibilityIdentifier("swipe-allow-\(session.id)")
        } else if waitsForQuestion {
            Button("Answer", systemImage: "text.bubble") { coordinator.selection = ref }
                .tint(StateColor.needsYou)
                .accessibilityIdentifier("swipe-answer-\(session.id)")
        } else {
            Button("Open", systemImage: "arrow.right.circle") { coordinator.selection = ref }
                .tint(StateColor.inactive)
                .accessibilityIdentifier("swipe-open-\(session.id)")
        }
    }

    private func decide(_ decision: PermissionDecision) {
        Task {
            let outcome = await model.decideOldestPending(decision, in: ref)
            if outcome == .openSession { coordinator.selection = ref }
        }
    }
}

extension View {
    func sessionRowSwipes(ref: SessionRef, session: SessionSummary) -> some View {
        modifier(SessionRowSwipes(ref: ref, session: session))
    }
}
