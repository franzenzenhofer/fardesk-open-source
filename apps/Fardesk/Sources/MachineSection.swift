import FardeskModels
import FardeskStore
import SwiftUI

/// One machine: header with online dot, then its live sessions and the recent ended ones (the daemon lists
/// only those; older ones are the coordinator's to find).
struct MachineSection: View {
    @Environment(AppModel.self) private var model
    @Environment(SharedClock.self) private var clock
    let machine: MachineState
    /// The home chosen in the list filter; nil shows every session.
    let homeFilter: String?
    @State private var isExpanded = true
    @State private var offlineReason: OfflineReason?
    @State private var reorders = false

    private var presentation: MachinePresentation { MachinePresentation(machine: machine, now: clock.now) }

    var body: some View {
        Section {
            if isExpanded, !model.runsDifferentVersion(machine.id) {
                let sessions = HomeTag.filtered(machine.listedSessions, by: homeFilter)
                ForEach(sessions) { row($0, isLast: $0.id == sessions.last?.id) }
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Button { tapHeader() } label: {
                    MachineHeader(presentation: presentation, isExpanded: isExpanded)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in reorders = true })
                .accessibilityIdentifier("machine-header-\(presentation.name)")
                .accessibilityHint(presentation.isOnline ? "Shows or hides its chats. Long press to change the order." : "Shows why it does not answer.")
                if let problem = presentation.problem {
                    Text(problem).font(.subheadline).foregroundStyle(.secondary).textCase(nil)
                }
                if model.runsDifferentVersion(machine.id) {
                    Text(differentVersionText).font(.body).foregroundStyle(.primary).textCase(nil)
                    if model.updatePlan.needsUpdate(machine.id) { UpdateAllButton().textCase(nil) }
                }
            }
            .id(MachineAnchor.id(machine.id))
            .sheet(item: $offlineReason) { OfflineReasonSheet(reason: $0) }
            .sheet(isPresented: $reorders) { MachineOrderSheet() }
        }
    }

    /// Online: show or hide its chats. Offline: say why it does not answer.
    private func tapHeader() {
        if case .offline = machine.connection {
            offlineReason = model.offlineReason(for: machine)
        } else {
            withAnimation { isExpanded.toggle() }
        }
    }

    /// Inset dividers between rows only: none above the first row, none below the last (owner design kit).
    private func row(_ session: SessionSummary, isLast: Bool) -> some View {
        let ref = SessionRef(machineID: machine.id, sessionID: session.id)
        return SessionRow(ref: ref, session: session)
            .opacity(presentation.isDimmed ? 0.5 : 1)
            .listRowSeparator(.hidden, edges: .top)
            .listRowSeparator(isLast ? .hidden : .visible, edges: .bottom)
    }
}

private struct MachineHeader: View {
    let presentation: MachinePresentation
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text(presentation.name).font(.headline).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            MachineStatusBadge(presentation: presentation)
            if let offlineSince = presentation.offlineSinceLabel {
                Text(offlineSince).font(.subheadline).foregroundStyle(.secondary)
            }
            if let latency = presentation.latencyLabel {
                Text(latency).font(.subheadline).foregroundStyle(.secondary)
            }
            Image(systemName: "chevron.down")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .rotationEffect(.degrees(isExpanded ? 0 : -90))
        }
        .textCase(nil)
        .contentShape(.rect)
    }
}
