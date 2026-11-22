import FardeskModels
import FardeskStore
import SwiftUI

/// The permissions and questions Claude waits on, as the last rows of the feed. Reads the feed itself, so only
/// this view (not the whole session screen) redraws when a row arrives.
struct PendingRequestCards: View {
    let ref: SessionRef
    let box: FeedBox

    var body: some View {
        ForEach(box.feed.pendingRequests) { RequestCard(activity: $0, ref: ref) }
        ForEach(box.feed.terminalRequests) { activity in
            if let presentation = TerminalRequestPresentation(activity) { TerminalRequestCard(presentation: presentation, ref: ref) }
        }
    }
}

/// The "needs you" card of a waiting session whose feed holds no request card (`AttentionCard`): a dialog open in
/// the terminal, or an approval or question still loading. A session counted as "needs you" never opens on nothing.
struct AttentionCardView: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let box: FeedBox

    private var session: SessionSummary? {
        (try? model.state.machine(id: ref.machineID))?.sessions.first { $0.id == ref.sessionID }
    }

    var body: some View {
        let feedShowsRequest = !box.feed.pendingRequests.isEmpty || !box.feed.terminalRequests.isEmpty
        if let session, let card = AttentionCard.resolve(session: session, feedShowsRequest: feedShowsRequest) {
            VStack(alignment: .leading, spacing: 12) {
                switch card {
                case .atComputer(let dialog):
                    Label("Needs you at the computer", systemImage: FardeskSymbol.waiting)
                        .font(.headline).foregroundStyle(StateColor.needsYou)
                    Text(dialog).font(.body).textSelection(.enabled)
                    Text("Answer it in the terminal on that computer, or tap Fix it and a new Claude looks into it. Then this chat goes on by itself.")
                        .font(.body).foregroundStyle(.secondary)
                    Button { fixIt() } label: { Text("Fix it").frame(maxWidth: .infinity) }
                        .buttonStyle(.fardeskPrimary).controlSize(.large)
                        .disabledInDemo(.sessionActions)
                        .accessibilityIdentifier("attention-fix-it")
                    Button { coordinator.terminalTarget = ref } label: { Text("Show the terminal command").frame(maxWidth: .infinity) }
                        .buttonStyle(.fardeskSecondary).controlSize(.large)
                case .loadingRequest(let text):
                    Label(text, systemImage: FardeskSymbol.waiting)
                        .font(.headline).foregroundStyle(StateColor.needsYou)
                    Button { Task { await model.openSession(ref) } } label: { Text("Load again").frame(maxWidth: .infinity) }
                        .buttonStyle(.fardeskSecondary).controlSize(.large)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: .rect(cornerRadius: 20))
            .accessibilityIdentifier("attention-card")
        }
    }

    private func fixIt() {
        Task { coordinator.selection = await model.fixIt(ref) ?? coordinator.selection }
    }
}

/// The step log as a row of the feed ("Loading the last 50 rows...") while something runs, failed, or the feed
/// has no rows to show yet.
struct FeedStepLog: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let box: FeedBox

    var body: some View {
        if let log = model.stepLogs[ref], log.isVisible(feedHasRows: !box.feed.rows.isEmpty) {
            StepLogView(log: log)
        }
    }
}
