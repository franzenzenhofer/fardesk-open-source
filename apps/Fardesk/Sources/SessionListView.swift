import FardeskStore
import SwiftUI

/// Mockup 01: large title, one section per machine, "needs you" and "New" at the bottom.
struct SessionListView: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator

    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var clock = SharedClock()
    @State private var homeFilter: String?

    /// The Claude homes to filter by; empty (no filter shown) while no machine has more than one home.
    private var homeChoices: [String] { HomeTag.filterChoices(machines: model.state.machines) }

    private var hasNoSessions: Bool { model.state.machines.allSatisfy { $0.listedSessions.isEmpty } }

    /// In the iPhone stack the list clears the selection when the screen is popped. With a detail
    /// column beside the list (iPad, Mac) a list update must not close the open session.
    private var selection: Binding<Route?> {
        Binding(
            get: { coordinator.route },
            set: { newValue in
                guard newValue != nil || sizeClass == .compact else { return }
                if newValue == .coordinator, coordinator.route != .coordinator { TapClock.start("coordinator.open") }
                if case .session = newValue, newValue != coordinator.route { TapClock.start("session.open") }
                coordinator.route = newValue
            }
        )
    }

    var body: some View {
        let _ = Breadcrumbs.mark("view SessionListView")
        ScrollViewReader { proxy in
        List(selection: selection) {
                if model.isDemo { Section { DemoNoticeRow().selectionDisabled() } }
                if !DebugFlags.noHubRow {
                    if model.hubStatus != nil, model.hubBannerText != nil { Section { HubStatusRow() } }
                    if let banner = model.connectivityBanner {
                        Section { ConnectivityBannerView(banner: banner) }
                    }
                }
                if model.notices[.list] != nil { Section { NoticeRow(scope: .list) } }
                if model.showsUpdateLine { Section { UpdateLine() } }
                if !model.state.machines.isEmpty {
                    Section {
                        MachineTableOfContents(machines: model.state.machines) { jump(to: $0, proxy) }
                    }
                }
                Section { CoordinatorRow() }
                if hasNoSessions, model.state.machines.contains(where: { $0.connection == .connecting }) || model.state.machines.isEmpty {
                    SkeletonRows(count: 4).listRowBackground(Color.clear).selectionDisabled()
                } else if hasNoSessions {
                    ContentUnavailableView("No sessions", systemImage: "terminal")
                        .listRowBackground(Color.clear)
                        .selectionDisabled()
                }
                ForEach(model.state.machines) { machine in
                    MachineSection(machine: machine, homeFilter: homeFilter)
                }
            }
        .machineListStyle()
        .navigationTitle("Fardesk")
        #if os(iOS)
        .navigationBarTitleDisplayMode(DebugFlags.inlineTitle ? .inline : .automatic)
        #endif
        .toolbar {
            if !DebugFlags.noToolbar {
                if !homeChoices.isEmpty {
                    ToolbarItem(placement: .primaryAction) { HomeFilterMenu(choices: homeChoices, selection: $homeFilter) }
                }
                ToolbarItem(placement: .primaryAction) { PauseMenu() }
                ToolbarItem(placement: .primaryAction) {
                    Button { coordinator.showsSettings = true } label: { ToolbarIcon(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
        }
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .bottom) { if !DebugFlags.noBottomBar { BottomBar() } }
        .environment(clock)
        .task { await clock.run() }
        .onAppear { if !hasNoSessions { TapClock.finish("launch.list", model: model) } }
        .onChange(of: hasNoSessions) { _, empty in if !empty { TapClock.finish("launch.list", model: model) } }
        .onChange(of: homeChoices) { _, choices in
            if let chosen = homeFilter, !choices.contains(chosen) { homeFilter = nil }
        }
        }
    }

    /// A List cannot scroll to a section header, so the jump goes to the machine's first row, a little below the
    /// top so its header stays in sight; a machine without rows falls back to its header anchor.
    private func jump(to machineID: UUID, _ proxy: ScrollViewProxy) {
        let firstRow = model.state.machines.first { $0.id == machineID }?.listedSessions.first?.id
        withAnimation {
            if let firstRow {
                proxy.scrollTo(firstRow, anchor: UnitPoint(x: 0.5, y: 0.12))
            } else {
                proxy.scrollTo(MachineAnchor.id(machineID), anchor: .top)
            }
        }
    }
}

private extension View {
    /// Mockup 01: inset-grouped cards on the iPhone; the sidebar style next to a detail column.
    func machineListStyle() -> some View { modifier(MachineListStyle()) }
}

private struct MachineListStyle: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass

    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(iOS)
        if sizeClass == .compact {
            content.listStyle(.insetGrouped)
        } else {
            content.listStyle(.sidebar)
        }
        #else
        content.listStyle(.sidebar)
        #endif
    }
}

private struct BottomBar: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator

    var body: some View {
        // Two small floating buttons, no bar across the screen: the list keeps its room.
        HStack {
            if let text = NeedsYouLabel.text(count: model.needsYou.count) {
                Button(text, systemImage: "exclamationmark.circle", action: jump)
                    .foregroundStyle(StateColor.needsYou)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .fardeskGlassCapsule()
            }
            Spacer()
            Button("New", systemImage: "plus") {
                TapClock.start("newsession.open")
                coordinator.showsNewSession = true
            }
                .accessibilityIdentifier("new-session-button")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .fardeskGlassCapsule()
                .disabledInDemo(.newSession)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func jump() {
        guard let first = model.needsYou.first else { return }
        coordinator.selection = SessionRef(machineID: first.machineID, sessionID: first.session.id)
    }
}
