import FardeskStore
import SwiftUI

/// The pinned first row of the sessions list: a plain row tagged `Route.coordinator`, like every session row.
/// No button, no disabled state: tapping always selects it.
struct CoordinatorRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: CoordinatorPresentation.symbol)
                .font(.title3)
                .foregroundStyle(.tint)
            Text(CoordinatorPresentation.title).font(.headline)
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
        .tag(Route.coordinator)
        .disabledInDemo(.coordinator)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("coordinator-row")
    }
}

/// The Coordinator screen. It never changes the selection: with a session it is the normal feed and composer
/// titled "Coordinator", without one the empty state, suggestions and the composer. It opens without waiting for the network.
struct CoordinatorScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let _ = Breadcrumbs.mark("view CoordinatorScreen")
        Group {
            if !model.coordinatorEnabled {
                CoordinatorOff(machineName: model.hubDisplayName)
            } else if let ref = model.coordinatorRef {
                SessionView(ref: ref, title: CoordinatorPresentation.title)
            } else {
                EmptyCoordinator()
            }
        }
        .onAppear { TapClock.finish("coordinator.open", model: model) }
        .task { await model.refreshCoordinator() }
    }
}

/// The machine runs no Coordinator (config `coordinator.enabled` is off): said in words instead of a composer that cannot work.
private struct CoordinatorOff: View {
    let machineName: String

    var body: some View {
        ContentUnavailableView {
            Label(CoordinatorPresentation.title, systemImage: CoordinatorPresentation.symbol)
        } description: {
            Text(CoordinatorPresentation.offText(machineName: machineName))
        }
        .navigationTitle(CoordinatorPresentation.title)
    }
}

/// No coordinator session yet: the empty state and the composer; the first message starts it.
private struct EmptyCoordinator: View {
    @Environment(AppModel.self) private var model

    private var pendingRef: SessionRef? { model.coordinatorPendingRef }
    private var hubName: String { model.hubDisplayName }

    var body: some View {
        VStack(spacing: 0) {
            let pending = pendingRef.map { model.outbox.pending(for: $0) } ?? []
            if pending.isEmpty {
                ContentUnavailableView {
                    Label(CoordinatorPresentation.title, systemImage: CoordinatorPresentation.symbol)
                } description: {
                    Text(CoordinatorPresentation.emptyStateText)
                } actions: {
                    VStack(spacing: 8) {
                        ForEach(CoordinatorPresentation.suggestions, id: \.self) { suggestion in
                            Button(suggestion) { _ = ask(suggestion) }.buttonStyle(.fardeskSecondary)
                        }
                    }
                }
            } else {
                ScrollView {
                    VStack(alignment: .trailing, spacing: 12) {
                        ForEach(pending) { PendingMessageRow(message: $0) }
                        if let ref = pendingRef, let log = model.stepLogs[ref] { StepLogView(log: log) }
                    }
                    .padding()
                }
            }
            NoticeRow(scope: .list).padding(.horizontal)
            MessageField { ask($0.text) }
                .padding()
                .background(.bar)
        }
        .navigationTitle(CoordinatorPresentation.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationSubtitle(CoordinatorPresentation.screenSubtitle(machine: hubName))
    }

    /// The message shows at once as queued; the screen turns into the feed when the session exists.
    private func ask(_ prompt: String) -> Bool {
        guard let machine = model.hubMachineID else {
            model.tell("No machine yet - connecting to the hub...", failed: false)
            return false
        }
        model.askCoordinatorQueued(prompt, on: machine)
        return true
    }
}
