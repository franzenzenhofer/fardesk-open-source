import FardeskModels
import FardeskStore
import SwiftUI

/// The full plan, scrolling inside the card; "Show the whole plan" lifts the height limit.
struct PlanText: View {
    let plan: String
    @State private var showsAll = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showsAll {
                MarkdownText(text: plan)
            } else {
                ScrollView { MarkdownText(text: plan).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 320)
            }
            Button(showsAll ? "Show less" : "Show the whole plan") { showsAll.toggle() }
                .buttonStyle(.fardeskSecondary)
                .accessibilityIdentifier("plan-expand")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.secondary.opacity(0.12), in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("plan-text")
    }
}

/// Claude Code's three answers to "Ready to code?", in its words and order.
struct PlanChoices: View {
    @Environment(AppModel.self) private var model
    let plan: PlanPresentation
    let requestID: String
    let ref: SessionRef
    @State private var feedback = ""
    @State private var isRevising = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(plan.choices, id: \.self) { choice in
                Button { tap(choice) } label: { Text(choice.title).frame(maxWidth: .infinity) }
                    .buttonStyle(choice == plan.choices.first ? .fardeskPrimary : .fardeskSecondary)
                    .accessibilityIdentifier("plan-\(choice.rawValue)")
            }
            if isRevising { revisionField }
        }
        .controlSize(.large)
    }

    private var revisionField: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("What should Claude change?", text: $feedback, axis: .vertical)
                .lineLimit(2...6)
                .padding(12)
                .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
                .accessibilityIdentifier("plan-feedback")
            Button { send(.revise, message: feedback) } label: { Text("Send").frame(maxWidth: .infinity) }
                .buttonStyle(.fardeskPrimary)
                .disabled(feedback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("plan-send-feedback")
        }
    }

    private func tap(_ choice: PlanPresentation.Choice) {
        if choice == .revise { isRevising.toggle() } else { send(choice.decision, message: nil) }
    }

    private func send(_ decision: PermissionDecision, message: String?) {
        Task { await model.decidePlan(ref, requestID: requestID, decision: decision, message: message) }
    }
}
