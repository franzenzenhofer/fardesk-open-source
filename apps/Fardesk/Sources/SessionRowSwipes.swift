import FardeskModels
import FardeskStore
import SwiftUI

/// The swipes of a session row, from `SessionSwipePlan` (unit tested): left to right Pin (or Unpin), right to left
/// End this chat (or Remove from list once stopped). One button per side, and nothing runs until it is tapped.
/// Every button is a solid dark fill with a white label and an icon (`SwipeFill`, contrast checked in tests).
struct SessionRowSwipes: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let session: SessionSummary

    private var plan: SessionSwipePlan { SessionSwipePlan(session: session) }

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                ForEach(plan.leading, id: \.self) { button(for: $0) }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ForEach(plan.trailing, id: \.self) { button(for: $0) }
            }
    }

    @ViewBuilder
    private func button(for action: SessionSwipePlan.Action) -> some View {
        switch action {
        case .pin:
            Button("Pin", systemImage: "pin.fill") { label(.pin(true)) }
                .tint(StateColor.fill(.ready)).accessibilityIdentifier("swipe-pin-\(session.id)")
                .disabledInDemo(.sessionActions)
        case .unpin:
            Button("Unpin", systemImage: "pin.slash.fill") { label(.pin(false)) }
                .tint(StateColor.fill(.ready)).accessibilityIdentifier("swipe-unpin-\(session.id)")
                .disabledInDemo(.sessionActions)
        case .end:
            Button("End this chat", systemImage: "xmark.octagon.fill") { Task { await model.kill(ref, closeTab: true) } }
                .tint(StateColor.fill(.broken)).accessibilityIdentifier("swipe-end-\(session.id)")
                .disabledInDemo(.sessionActions)
        case .hide:
            Button("Remove from list", systemImage: "eye.slash.fill") { Task { await model.hide(ref) } }
                .tint(StateColor.fill(.inactive)).accessibilityIdentifier("swipe-hide-\(session.id)")
                .disabledInDemo(.sessionActions)
        }
    }

    private func label(_ request: LabelRequest) {
        Task { await model.label(request, ref) }
    }
}

extension View {
    func sessionRowSwipes(ref: SessionRef, session: SessionSummary) -> some View {
        modifier(SessionRowSwipes(ref: ref, session: session))
    }
}
