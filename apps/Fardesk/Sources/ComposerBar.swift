import FardeskModels
import FardeskStore
import SwiftUI

/// The bottom of a chat: the reply field while the session runs, one line and a button while it runs in its terminal,
/// and for a stopped chat its status and the three ways on (`StoppedFooter`). In the demo it is shown but greyed.
struct ComposerBar: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @Environment(VoiceReader.self) private var voice
    let ref: SessionRef
    let session: SessionSummary
    let mode: ComposerMode

    var body: some View {
        Group {
            switch mode {
            case .composer:
                MessageField { message in
                    voice.stop()
                    let result = await model.submit(message.outgoing, to: ref)
                    if case .cleared(let fresh) = result { coordinator.selection = fresh }
                    return result != .failed
                }
            case .takeover(let label): moveButton(label, info: "Running in its terminal") { await model.takeover(ref) }
            case .resume: stoppedFooter
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.bar)
        .disabledInDemo(.composer)
    }

    private var stoppedFooter: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(StoppedFooter.statusLine(session, now: .now)).font(.body).foregroundStyle(.secondary)
                .accessibilityIdentifier("stopped-status")
            ForEach(StoppedFooter.Choice.allCases, id: \.self) { choice in
                Button { choose(choice) } label: { Text(choice.title).frame(maxWidth: .infinity) }
                    .buttonStyle(choice == .resume ? .fardeskPrimary : .fardeskSecondary)
                    .accessibilityIdentifier("stopped-\(choice.rawValue)")
            }
        }
    }

    private func choose(_ choice: StoppedFooter.Choice) {
        switch choice {
        case .resume: run { await model.resume(ref) }
        case .summary: run { await model.compact(ref) }
        case .fresh:
            // The New Session screen, filled from this chat: same computer, folder, account, mode and model.
            coordinator.newSessionPreset = .startingFresh(from: session, on: ref.machineID)
            coordinator.showsNewSession = true
        }
    }

    private func run(_ action: @escaping () async -> SessionRef?) {
        Task { coordinator.selection = await action() ?? coordinator.selection }
    }

    private func moveButton(_ label: String, info: String?, _ action: @escaping () async -> SessionRef?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info {
                Label(info, systemImage: FeedSymbol.info).font(.body).foregroundStyle(.secondary)
            }
            Button { run(action) } label: {
                Text(label).frame(maxWidth: .infinity)
            }
            .buttonStyle(.fardeskPrimary)
        }
    }
}
