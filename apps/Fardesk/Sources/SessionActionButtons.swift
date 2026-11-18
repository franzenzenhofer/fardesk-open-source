import FardeskModels
import FardeskStore
import SwiftUI

/// Every action on a session, used by the "Actions" menu and the row's context menu. Every item has its words:
/// the three that matter most first (Clear, Compact, End session), the rest below, the rarely used ones in "More".
struct SessionActionButtons: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        Section {
            if session.status != .ended {
                Button("Clear", systemImage: "eraser") { move(model.clear) }
                Button("Compact", systemImage: "rectangle.compress.vertical") { move(model.compact) }
            }
            EndSessionButton(ref: ref, session: session)
        }
        SessionLabelButtons(ref: ref, session: session)
        Section {
            if session.canStop {
                Button("Stop", systemImage: FardeskSymbol.stop) { Task { await model.stop(ref) } }
            }
            switch session.replyMode {
            case .composer: EmptyView()
            case .takeover: Button("Take over", systemImage: "arrow.down.right.and.arrow.up.left") { move(model.takeover) }
            case .resume: Button("Resume", systemImage: "play.circle") { move(model.beginResume) }
            }
            Button("Fork", systemImage: "arrow.triangle.branch") { move(model.fork) }
            Button(session.muted ? "Unmute" : "Mute", systemImage: session.muted ? "bell" : "bell.slash") {
                Task { await model.mute(!session.muted, ref) }
            }
            Menu("More", systemImage: "ellipsis.circle") {
                Button("Open in terminal", systemImage: "terminal") { coordinator.terminalTarget = ref }
                PinLiveActivityButton(ref: ref)
                VoiceMenuItems()
                Button("Copy session ID", systemImage: "doc.on.doc") { Clipboard.copy(session.id) }
                if let mode = session.permissionMode { Label("Mode: \(mode.label)", systemImage: "lock.shield") }
            }
        }
    }

    private func move(_ action: @escaping (SessionRef) async -> SessionRef?) {
        Task { coordinator.selection = await action(ref) ?? coordinator.selection }
    }
}

/// Stop and End session, for the row's swipe.
struct StopKillButtons: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        if session.canStop {
            Button("Stop", systemImage: FardeskSymbol.stop) { Task { await model.stop(ref) } }
        }
        EndSessionButton(ref: ref, session: session)
    }
}

/// End session: stops Claude and closes its terminal tab when it has one (one action, confirmed first).
struct EndSessionButton: View {
    @Environment(SessionCoordinator.self) private var coordinator
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        if session.status != .ended {
            Button("End session", systemImage: "xmark.octagon", role: .destructive) { coordinator.killTarget = ref }
        }
    }
}

/// The confirmation every end goes through, attached once at the top of the screen. After it ended, the
/// session screen closes and the list shows.
struct KillConfirmation: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator

    func body(content: Content) -> some View {
        content.confirmationDialog(
            "End this session? Claude stops and its terminal tab closes.",
            isPresented: Binding(
                get: { coordinator.killTarget != nil },
                set: { if !$0 { coordinator.killTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("End session", role: .destructive) { kill() }
            Button("Cancel", role: .cancel) { coordinator.killTarget = nil }
        }
    }

    private func kill() {
        guard let ref = coordinator.killTarget else { return }
        coordinator.killTarget = nil
        Task {
            guard await BiometricGate.confirm(reason: "End this session") else { return }
            guard await model.kill(ref, closeTab: true) else { return }
            if coordinator.selection == ref { coordinator.selection = nil }
        }
    }
}

extension View {
    func confirmsKill() -> some View { modifier(KillConfirmation()) }
}
