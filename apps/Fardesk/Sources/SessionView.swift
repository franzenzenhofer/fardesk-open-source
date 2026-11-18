import FardeskModels
import FardeskStore
import SwiftUI

/// Mockups 02 to 04: the feed, the sticky request card and the composer of one session.
struct SessionView: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    /// Shown instead of the session's own title (the Coordinator).
    var title: String?

    private var machine: MachineState? { try? model.state.machine(id: ref.machineID) }
    private var session: SessionSummary? { machine?.sessions.first { $0.id == ref.sessionID } }

    var body: some View {
        Group {
            if let machine, let session {
                content(machine: machine, session: session)
            } else if let log = model.stepLogs[ref] {
                VStack { Spacer(); StepLogView(log: log).padding(.horizontal); Spacer() }
            } else {
                ContentUnavailableView("Session not found", systemImage: "terminal")
            }
        }
        .task(id: ref) { await model.openSession(ref) }
        .onDisappear { model.leaveSession(ref) }
    }

    private func content(machine: MachineState, session: SessionSummary) -> some View {
        let _ = Breadcrumbs.mark("view SessionView")
        let box = model.feeds.box(for: ref)
        let presentation = SessionPresentation(session: session, now: Date())
        let line = SessionHeaderLine(session: session, machineName: machine.endpoint.name)
        return VStack(spacing: 0) {
            FeedView(ref: ref, box: box).environment(\.attachmentSession, ref)
            ComposerBar(ref: ref, mode: presentation.composerMode)
        }
        .onAppear { TapClock.finish("session.open", model: model) }
        .readsAloud(box: box, status: session.status)
        .navigationTitle(title ?? session.displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) {
                SessionTitleView(ref: ref, title: title ?? session.displayTitle, line: line, session: session, machineName: machine.endpoint.name)
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    SessionActionButtons(ref: ref, session: session)
                } label: {
                    Text("Actions").font(.body.weight(.semibold)).frame(minHeight: 44).contentShape(.rect)
                }
                .accessibilityIdentifier("session-actions")
            }
        }
    }

}
