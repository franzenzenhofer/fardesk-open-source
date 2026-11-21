import FardeskStore
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @Environment(\.scenePhase) private var scenePhase
    @State private var isStopped = false

    var body: some View {
        Group {
            switch model.phase {
            case .launching: LaunchView()
            case .ready: MachinesView()
            case .loggedOut, .loggingIn: LoginView()
            }
        }
        .task { await startModel() }
        .onChange(of: model.phase) { _, phase in
            coordinator.reset()
            PlatformPush.phaseChanged(to: phase)
        }
        .onChange(of: scenePhase) { _, phase in
            model.noteActivity(phase == .active ? .active : .away)
            guard model.phase == .ready else { return }
            if phase == .background {
                model.stop()
                isStopped = true
            } else if phase == .active, isStopped {
                isStopped = false
                Task { await model.start() }
            }
        }
    }

    private func startModel() async {
        while model.phase == .launching { try? await Task.sleep(for: .milliseconds(50)) }
        PlatformPush.phaseChanged(to: model.phase)
        #if DEBUG
        if model.phase != .ready, let link = UserDefaults.standard.string(forKey: "FardeskPairLink") {
            await model.pair(link: link)
        }
        try? await Task.sleep(for: .seconds(1))
        showDebugScreen()
        #endif
    }

    #if DEBUG
    /// Launch argument `-FardeskScreen new|settings`, `-FardeskOpenSession <id prefix>` (with `-FardeskScreen terminal` for the terminal sheet) opens that sheet, for screenshots without clicking.
    private func showDebugScreen() {
        switch UserDefaults.standard.string(forKey: "FardeskScreen") {
        case "new": coordinator.showsNewSession = true
        case "settings": coordinator.showsSettings = true
        default: break
        }
        guard let prefix = UserDefaults.standard.string(forKey: "FardeskOpenSession") else { return }
        for machine in model.state.machines {
            guard let session = machine.sessions.first(where: { $0.id.hasPrefix(prefix) }) else { continue }
            coordinator.selection = SessionRef(machineID: machine.id, sessionID: session.id)
            if UserDefaults.standard.string(forKey: "FardeskScreen") == "terminal" {
                coordinator.terminalTarget = coordinator.selection
            }
            return
        }
    }
    #endif
}
