import FardeskModels

extension SessionSummary {
    /// The daemon runs its coordinator in `<stateDir>/coordinator`, stateDir `~/.local/state/fardesk` by default.
    static let coordinatorFolderSuffix = "/fardesk/coordinator"

    /// A session the daemon's coordinator ran: shown as the Coordinator row, never as a project session.
    public var isCoordinatorSession: Bool { cwd.hasSuffix(Self.coordinatorFolderSuffix) }
}
