import FardeskModels
import FardeskStore
import SwiftUI

/// The scroll anchor of one machine's section in the session list.
enum MachineAnchor {
    static func id(_ machineID: UUID) -> String { "machine-section-\(machineID.uuidString)" }
}

/// One chip: the machine, its status dot and how many sessions live or need the human.
struct TocEntry: Equatable, Identifiable {
    let id: UUID
    let name: String
    let isOnline: Bool
    let live: Int
    let needsYou: Int

    init(machine: MachineState) {
        id = machine.id
        name = machine.endpoint.name
        isOnline = machine.isOnline
        live = machine.activeSessions.count
        needsYou = machine.activeSessions.filter { $0.status == .waiting }.count
    }
}

/// The table of contents at the top of the session list: one chip per machine, in section order.
struct MachineTableOfContents: View {
    let machines: [MachineState]
    let jump: (UUID) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(machines.map(TocEntry.init(machine:))) { entry in
                    Button { jump(entry.id) } label: { TocChip(entry: entry) }
                        .buttonStyle(.fardeskChip)
                        .accessibilityIdentifier("toc-chip-\(entry.name)")
                }
            }
            .padding(.horizontal, 16)
        }
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .selectionDisabled()
    }
}

private struct TocChip: View {
    let entry: TocEntry

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(entry.isOnline ? StateColor.ok : StateColor.inactive).frame(width: 10, height: 10)
            Text(entry.name).font(.subheadline.weight(.semibold))
            if entry.live > 0 { Text("\(entry.live) live").font(.subheadline).foregroundStyle(.secondary) }
            if entry.needsYou > 0 {
                Text("\(entry.needsYou) needs you").font(.subheadline.weight(.semibold)).foregroundStyle(StateColor.needsYou)
            }
        }
        .foregroundStyle(.primary)
    }
}
