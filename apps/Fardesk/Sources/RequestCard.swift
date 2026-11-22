import FardeskModels
import FardeskStore
import SwiftUI

/// The sticky card above the composer for a pending permission or question (mockup 03).
struct RequestCard: View {
    @Environment(AppModel.self) private var model
    let activity: Activity
    let ref: SessionRef
    @State private var pendingAllow: PermissionDecision?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch activity {
            case .permission(let permission): permissionBody(permission)
            case .question(let question): questionBody(question)
            case .dialog(let dialog): dialogBody(dialog)
            default: EmptyView()
            }
        }
        .padding()
        .background(.regularMaterial, in: .rect(cornerRadius: 20))
        .disabledInDemo(.sessionActions)
    }

    private func permissionBody(_ permission: PermissionActivity) -> some View {
        let presentation = PermissionPresentation(permission: permission)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: FeedSymbol.shield).font(.title).foregroundStyle(StateColor.needsYou)
                VStack(alignment: .leading, spacing: 2) {
                    Text(presentation.cardTitle).font(.title3.bold())
                    Text(presentation.cwdLabel).font(.body).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if PlanPresentation(permission: permission)?.offersChoices != true {
                    Menu("More", systemImage: "ellipsis") {
                        Button("Always allow") { request(.allowAlways, permission, presentation) }
                    }
                    .labelStyle(.iconOnly)
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            if let plan = PlanPresentation(permission: permission) {
                PlanText(plan: plan.plan)
                if plan.offersChoices { PlanChoices(plan: plan, requestID: permission.requestId, ref: ref) } else { allowDenyButtons(permission, presentation) }
            } else {
                Text(presentation.summary)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.secondary.opacity(0.12), in: .rect(cornerRadius: 12))
                allowDenyButtons(permission, presentation)
            }
        }
        .confirmationDialog(
            "This looks destructive.",
            isPresented: Binding(get: { pendingAllow != nil }, set: { if !$0 { pendingAllow = nil } }),
            titleVisibility: .visible
        ) {
            Button("Allow", role: .destructive) { confirmAllow(permission) }
            Button("Cancel", role: .cancel) { pendingAllow = nil }
        }
    }

    private func allowDenyButtons(_ permission: PermissionActivity, _ presentation: PermissionPresentation) -> some View {
        HStack(spacing: 12) {
            Button { decide(.deny, permission) } label: { Text("Deny").frame(maxWidth: .infinity) }
                .buttonStyle(.fardeskSecondary)
            Button { request(.allow, permission, presentation) } label: { Text("Allow").frame(maxWidth: .infinity) }
                .buttonStyle(.fardeskPrimary)
        }
        .controlSize(.large)
    }

    private func questionBody(_ question: QuestionActivity) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(question.text, systemImage: FardeskSymbol.question).font(.headline)
            ForEach(question.options, id: \.self) { option in
                Button(option) { Task { await model.answer(option, requestID: question.requestId, in: ref) } }
                    .buttonStyle(.fardeskSecondary)
            }
        }
    }

    /// A dialog Claude Code asks itself: its title and words, one button per choice it offers.
    private func dialogBody(_ dialog: DialogActivity) -> some View {
        let shown = DialogPresentation(dialog, now: Date())
        return VStack(alignment: .leading, spacing: 12) {
            Label(shown.title, systemImage: FardeskSymbol.question).font(.headline)
            if !shown.text.isEmpty { Text(shown.text).font(.body) }
            ForEach(shown.buttons) { button in
                Button { Task { await model.answerDialog(ref, requestID: dialog.requestId, answer: button.answer) } } label: {
                    Text(button.title).frame(maxWidth: .infinity)
                }
                .buttonStyle(button.isFocused ? .fardeskPrimary : .fardeskSecondary)
                .accessibilityIdentifier("dialog-\(button.answer)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dialog-card")
    }

    private func request(_ decision: PermissionDecision, _ permission: PermissionActivity, _ presentation: PermissionPresentation) {
        if presentation.requiresConfirmation { pendingAllow = decision } else { decide(decision, permission) }
    }

    private func confirmAllow(_ permission: PermissionActivity) {
        guard let decision = pendingAllow else { return }
        pendingAllow = nil
        Task {
            guard await BiometricGate.confirm(reason: "Allow this action") else { return }
            await model.decide(decision, requestID: permission.requestId, in: ref)
        }
    }

    private func decide(_ decision: PermissionDecision, _ permission: PermissionActivity) {
        Task { await model.decide(decision, requestID: permission.requestId, in: ref) }
    }
}
