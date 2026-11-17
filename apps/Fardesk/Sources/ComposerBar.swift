import FardeskStore
import SwiftUI

/// The reply bar: a text field, or an info line and one button to take over or resume the session.
struct ComposerBar: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @Environment(VoiceReader.self) private var voice
    let ref: SessionRef
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
            case .takeover(let label): moveButton(label, info: "Running in terminal") { await model.takeover(ref) }
            case .resume(let label): moveButton(label, info: nil) { await model.beginResume(ref) }
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private func moveButton(_ label: String, info: String?, _ action: @escaping () async -> SessionRef?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info {
                Label(info, systemImage: FeedSymbol.info).font(.body).foregroundStyle(.secondary)
            }
            Button { Task { coordinator.selection = await action() ?? coordinator.selection } } label: {
                Text(label).frame(maxWidth: .infinity)
            }
            .buttonStyle(.fardeskPrimary)
        }
    }
}
