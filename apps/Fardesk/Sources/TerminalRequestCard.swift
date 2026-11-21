import FardeskModels
import FardeskStore
import SwiftUI

/// The card for a question or permission that was handed off to the computer: it names what the dialog asks and, when
/// the daemon can type into that terminal, answers it from here. Orange, like every "needs you" state.
struct TerminalRequestCard: View {
    @Environment(AppModel.self) private var model
    let presentation: TerminalRequestPresentation
    let ref: SessionRef

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(TerminalRequestPresentation.title, systemImage: FardeskSymbol.question)
                .font(.headline)
                .foregroundStyle(StateColor.needsYou)
            Text(presentation.text)
                .font(presentation.isPermission ? .system(.body, design: .monospaced) : .body)
                .textSelection(.enabled)
            if presentation.choices.isEmpty {
                ForEach(presentation.options, id: \.self) { option in
                    Text(option).font(.body).foregroundStyle(.secondary)
                }
            }
            ForEach(presentation.choices, id: \.self) { choice in
                Button { tap(choice) } label: { Text(label(choice)).frame(maxWidth: .infinity) }
                    .buttonStyle(.fardeskSecondary)
                    .controlSize(.large)
            }
            if let footnote = presentation.footnote {
                Text(footnote).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: .rect(cornerRadius: 20))
    }

    private func label(_ choice: TerminalRequestPresentation.Choice) -> String {
        switch choice {
        case .option(let option): option
        case .allow: "Allow"
        case .deny: "Deny"
        }
    }

    private func tap(_ choice: TerminalRequestPresentation.Choice) {
        let id = presentation.requestID
        Task {
            switch choice {
            case .option(let option): await model.answer(option, requestID: id, in: ref)
            case .allow: await model.decide(.allow, requestID: id, in: ref)
            case .deny: await model.decide(.deny, requestID: id, in: ref)
            }
        }
    }
}
