import FardeskModels
import FardeskStore
import SwiftUI

/// Mockup 05: pick machine, folder, model and prompt, then start.
struct NewSessionView: View {
    private static let maxFolders = 6

    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @Environment(\.dismiss) private var dismiss
    @State private var draft: NewSessionDraft
    @State private var folders: [RecentFolder] = []
    @State private var isStarting = false
    /// Opened by "Start fresh here": everything is filled in, only the first message is left.
    private let startsFresh: Bool

    init(preset: NewSessionDraft? = nil) {
        _draft = State(initialValue: preset ?? NewSessionDraft())
        startsFresh = preset != nil
    }

    /// Read from the one small list the model keeps, never from the whole state: activity rows must not rebuild this sheet.
    private var onlineMachines: [OnlineMachine] { model.onlineMachines }
    private var selected: OnlineMachine? { onlineMachines.first { $0.id == draft.machineID } }
    /// The Claude homes to ask about: none while the machine has just one (the daemon then uses it).
    private var homeChoices: [String] { HomeTag.newSessionChoices(for: selected) }
    private var canAsk: Bool {
        selected != nil && !isStarting && CoordinatorPresentation.newSessionPrompt(describing: draft.description) != nil
    }

    var body: some View {
        let _ = Breadcrumbs.mark("view NewSessionView")
        NavigationStack {
            NewSessionForm(
                draft: $draft,
                machines: NewSessionPresentation.choices(onlineMachines.map { ($0.id, $0.name) }),
                folders: folders.prefix(Self.maxFolders).map(\.path),
                homes: homeChoices,
                models: selected?.models ?? [],
                permissionModes: NewSessionPresentation.permissionModes(for: selected),
                coordinatorEnabled: selected?.coordinatorEnabled ?? true,
                canAsk: canAsk,
                notice: NewSessionPresentation.noMachineNotice(onlineCount: onlineMachines.count, hubStatus: model.hubStatus),
                askCoordinator: askCoordinator
            )
            .navigationTitle(startsFresh ? "Start fresh" : "New Session")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start", role: .confirm, action: start).disabled(!draft.canStart || isStarting)
                        .accessibilityIdentifier("start-session-button")
                }
            }
            .onAppear { TapClock.finish("newsession.open", model: model) }
            .task { selectMachine() }
            .onChange(of: onlineMachines.map(\.id)) { selectMachine() }
            .task(id: draft.machineID) { await loadFolders() }
        }
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 760, idealHeight: 860)
        #endif
    }

    /// The machine is chosen again whenever the online machines change: the sheet may open while the hub still connects.
    private func selectMachine() {
        draft.machineID = NewSessionPresentation.defaultMachine(current: draft.machineID, online: onlineMachines.map(\.id))
        draft.keepModeAllowed(on: selected)
    }

    private func loadFolders() async {
        guard let machineID = draft.machineID else { return }
        folders = await model.recentFolders(on: machineID)?.folders ?? []
        draft.resetForMachine(firstFolder: folders.first?.path ?? "")
        draft.keepModeAllowed(on: selected)
    }

    private func askCoordinator() {
        guard let machineID = draft.machineID,
              let text = CoordinatorPresentation.newSessionPrompt(describing: draft.description) else { return }
        isStarting = true
        Task {
            if let ref = await model.askCoordinator(text, on: machineID) {
                coordinator.selection = ref
                dismiss()
            }
            isStarting = false
        }
    }

    private func start() {
        guard let machineID = draft.machineID else { return }
        isStarting = true
        coordinator.selection = model.startNewSession(draft.request(homeChoices: homeChoices), on: machineID)
        isStarting = false
        dismiss()
    }
}

/// The sections of the sheet, driven only by the draft and the choices it is given.
struct NewSessionForm: View {
    @Environment(AppModel.self) private var model
    @Binding var draft: NewSessionDraft
    let machines: [MachineChoice]
    let folders: [String]
    let homes: [String]
    let models: [String]
    let permissionModes: [PermissionMode]
    let coordinatorEnabled: Bool
    let canAsk: Bool
    let notice: String?
    let askCoordinator: () -> Void

    var body: some View {
        Form {
            if model.isDemo { Section { DemoNoticeLine() } }
            if let notice {
                Section { Label(notice, systemImage: "hourglass").font(.body) }
            }
            if coordinatorEnabled {
                Section(CoordinatorPresentation.describeTitle) {
                    TextField(CoordinatorPresentation.describePlaceholder, text: $draft.description, axis: .vertical)
                        .lineLimit(2...6)
                    Button(CoordinatorPresentation.describeButton, systemImage: CoordinatorPresentation.symbol, action: askCoordinator)
                        .disabled(!canAsk)
                }
            }
            machineSection
            if !homes.isEmpty { homeSection }
            folderSection
            Section {
                Toggle("New worktree", isOn: $draft.usesWorktree)
                Picker("Permissions", selection: $draft.permissionMode) {
                    ForEach(permissionModes, id: \.self) { Text($0.label).tag($0) }
                }
            }
            Section {
                Picker("Model", selection: $draft.modelName) {
                    Text("Default").tag(String?.none)
                    ForEach(models, id: \.self) { Text($0).tag(Optional($0)) }
                }
                #if os(iOS)
                .pickerStyle(.navigationLink)
                #endif
            }
            Section {
                TextEditor(text: $draft.prompt).frame(minHeight: 96)
            } header: {
                Text("Prompt")
            } footer: {
                if let footer = NewSessionPresentation.footer(machineName: selectedMachine?.fullName) { Text(footer) }
            }
        }
        .formStyle(.grouped)
    }

    private var selectedMachine: MachineChoice? { machines.first { $0.id == draft.machineID } }

    private var machineSection: some View {
        Section("Machine") {
            Picker("Machine", selection: $draft.machineID) {
                ForEach(machines) { Text($0.shortName).tag(Optional($0.id)) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if let selectedMachine {
                Text(selectedMachine.fullName).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    /// Which Claude home (account) the session starts in; shown only when the machine has several.
    private var homeSection: some View {
        Section("Home") {
            Picker("Home", selection: Binding(get: { draft.home(among: homes) }, set: { draft.homeName = $0 })) {
                ForEach(homes, id: \.self) { Text($0).tag(Optional($0)).accessibilityIdentifier("new-session-home-\($0)") }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityIdentifier("new-session-home-picker")
        }
    }

    private var folderSection: some View {
        Section("Folder") {
            ForEach(folders, id: \.self) { path in
                Button { draft.pick(folder: path) } label: {
                    HStack {
                        Text(FolderLabel.shortened(path)).foregroundStyle(.primary)
                        Spacer()
                        if !draft.showsOtherFolder && draft.folder == path {
                            Image(systemName: "checkmark").foregroundStyle(.tint)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            Button("Other...") { draft.showsOtherFolder = true }
                .accessibilityIdentifier("other-folder-button")
            if draft.showsOtherFolder {
                TextField("/path/to/folder", text: $draft.customFolder)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
            }
        }
    }
}
