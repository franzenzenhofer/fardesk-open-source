import FardeskModels
import FardeskStore
import SwiftUI

/// One machine: header with online dot, then its live sessions and the recent ended ones (the daemon lists
/// only those; older ones are the coordinator's to find).
struct MachineSection: View {
    @Environment(SharedClock.self) private var clock
    let machine: MachineState
    @State private var isExpanded = true

    private var presentation: MachinePresentation { MachinePresentation(machine: machine, now: clock.now) }

    var body: some View {
        Section {
            if isExpanded {
                ForEach(machine.listedSessions) { row($0) }
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Button { withAnimation { isExpanded.toggle() } } label: {
                    MachineHeader(presentation: presentation, isExpanded: isExpanded)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("machine-header-\(presentation.name)")
                if let problem = presentation.problem {
                    Text(problem).font(.subheadline).foregroundStyle(.secondary).textCase(nil)
                }
            }
            .id(MachineAnchor.id(machine.id))
        }
    }

    private func row(_ session: SessionSummary) -> some View {
        let ref = SessionRef(machineID: machine.id, sessionID: session.id)
        return SessionRow(ref: ref, session: session)
            .opacity(presentation.isDimmed ? 0.5 : 1)
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
