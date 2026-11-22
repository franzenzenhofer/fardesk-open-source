import FardeskModels
import FardeskStore
import SwiftUI

/// The **Update all** button: brings every machine up to the newest release one machine has.
struct UpdateAllButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { Task { await model.updateAll() } } label: {
            Text(model.isUpdating ? "Updating..." : "Update all").font(.body.weight(.semibold))
        }
        .buttonStyle(.fardeskPrimary)
        .disabled(model.isUpdating)
        .disabledInDemo(.machineUpdate)
        .accessibilityIdentifier("update-all")
    }
}

/// What the update of each machine says right now ("Updating...", "Updated to 4.2.0", "Failed: ...").
struct UpdateProgressLines: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ForEach(model.state.machines.filter { model.machineUpdates[$0.id] != nil }) { machine in
            if let progress = model.machineUpdates[machine.id] {
                Text("\(machine.endpoint.name): \(progress.text)").font(.body)
            }
        }
    }
}

/// The small line at the top of the list: only while an update exists or runs.
struct UpdateLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let plan = model.updatePlan
        if model.showsUpdateLine {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(plan.summary ?? (model.isUpdating ? "Updating machines" : "Update did not finish")).font(.body)
                    Spacer(minLength: 8)
                    if !plan.isEmpty { UpdateAllButton() }
                }
                UpdateProgressLines()
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("update-line")
        }
    }
}

/// Settings > Machines: the row "N machines can be updated" with the button, and each machine's progress.
struct UpdateSettingsRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let plan = model.updatePlan
        if let summary = plan.summary {
            HStack {
                Text(summary).font(.body)
                Spacer(minLength: 8)
                UpdateAllButton()
            }
        }
        UpdateProgressLines()
    }
}

/// The line under a machine in Settings: its version, and what is to do about it.
struct MachineVersionLine: View {
    @Environment(AppModel.self) private var model
    let machine: MachineState

    var body: some View {
        if let info = machine.machine {
            Text(text(info)).font(.body).foregroundStyle(.secondary)
        }
    }

    private func text(_ info: Machine) -> String {
        if !info.isCompatible { return differentVersionText }
        if let progress = model.machineUpdates[machine.id] { return "\(info.version), \(progress.text)" }
        return model.updatePlan.needsUpdate(machine.id) ? "\(info.version), update available" : info.version
    }
}
