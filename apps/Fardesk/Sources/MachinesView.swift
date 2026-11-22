import FardeskStore
import SwiftUI

/// Root: sessions grouped by machine in the sidebar, the open session in the detail column.
struct MachinesView: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator

    private var routeBinding: Binding<Route?> {
        Binding(get: { coordinator.route }, set: { coordinator.route = $0 })
    }

    @ViewBuilder
    private func screen(_ route: Route) -> some View {
        switch route {
        case .session(let ref): SessionView(ref: ref).id(ref)
        case .starting(let ref): StartingSessionView(ref: ref).id(ref)
        case .coordinator: CoordinatorScreen()
        }
    }

    /// The split view, or with the DEBUG launch arguments a stack (`-FardeskStack`) or a plain list (`-FardeskPlainList`).
    @ViewBuilder
    private var container: some View {
        if DebugFlags.plainList {
            List(model.state.machines) { Text($0.endpoint.name) }
        } else if DebugFlags.stack {
            NavigationStack {
                SessionListView().navigationDestination(item: routeBinding) { screen($0) }
            }
        } else {
            NavigationSplitView {
                SessionListView().navigationSplitViewColumnWidth(min: 300, ideal: 380, max: 480)
            } detail: {
                NavigationStack {
                    if let route = coordinator.route {
                        screen(route)
                    } else {
                        ContentUnavailableView("No session selected", systemImage: "terminal")
                    }
                }
            }
        }
    }

    var body: some View {
        @Bindable var coordinator = coordinator
        let _ = Breadcrumbs.mark("view MachinesView")
        container
        .confirmsKill()
        .promptsRename()
        .sheetsLabelColours()
        .sensoryFeedback(.impact(weight: .light), trigger: model.sendSignal)
        .sensoryFeedback(.error, trigger: model.failureSignal)
        .sheet(isPresented: $coordinator.showsSettings) { SettingsView() }
        .sheet(isPresented: $coordinator.showsNewSession, onDismiss: { coordinator.newSessionPreset = nil }) {
            NewSessionView(preset: coordinator.newSessionPreset)
        }
        .sheet(isPresented: Binding(get: { coordinator.terminalTarget != nil }, set: { if !$0 { coordinator.terminalTarget = nil } })) {
            if let ref = coordinator.terminalTarget { TerminalCommandSheet(ref: ref) }
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.dismissError() } })
        ) {
            Button("OK") { model.dismissError() }
        } message: {
            Text(model.lastError ?? "")
        }
    }
}
