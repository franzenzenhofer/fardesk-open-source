import FardeskModels
import Foundation

/// Which Claude home (account) a session lives in: the small tag, the list filter and the New Session choice.
/// All of it is hidden while a machine has only one home: there is nothing to tell apart.
public enum HomeTag {
    /// The tag next to the machine name; nil when the session has no home or the machine has a single home.
    public static func text(for session: SessionSummary, machineHomes: [String]) -> String? {
        machineHomes.count > 1 ? session.home : nil
    }

    /// The homes the list filter offers: every home name of every machine that has more than one, once, sorted.
    public static func filterChoices(machines: [MachineState]) -> [String] {
        let names = machines.map(\.homeNames).filter { $0.count > 1 }.flatMap { $0 }
        return Array(Set(names)).sorted()
    }

    /// The sessions of `home`; all of them when no home is chosen.
    public static func filtered(_ sessions: [SessionSummary], by home: String?) -> [SessionSummary] {
        guard let home else { return sessions }
        return sessions.filter { $0.home == home }
    }

    /// The homes the New Session sheet asks about: none when the machine has one home (the daemon uses it).
    public static func newSessionChoices(for machine: OnlineMachine?) -> [String] {
        (machine?.homes.count ?? 0) > 1 ? machine?.homes ?? [] : []
    }
}

extension MachineState {
    /// The names of this machine's Claude homes; empty until the machine has answered.
    public var homeNames: [String] { machine?.homes ?? [] }
}
