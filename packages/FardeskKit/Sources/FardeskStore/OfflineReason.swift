import Foundation

/// Why a machine does not answer, in words a non-specialist can act on (docs/design/STATES.md, machine states).
/// Tapping an offline machine's header shows this. The hub's own probe (`problem`) knows best; without a hub the
/// phone can only say what it sees itself.
public struct OfflineReason: Equatable, Sendable, Identifiable {
    public var id: String { title + reason }
    public let title: String
    public let reason: String
    public let whatToDo: String

    public init(machineName: String, hubProblem: String?, tailscaleIsOnHere: Bool) {
        title = "\(machineName) is not reachable"
        if !tailscaleIsOnHere {
            reason = "Tailscale is turned off on this device."
            whatToDo = "Turn Tailscale on here. Fardesk reconnects by itself."
        } else if let hubProblem, !hubProblem.isEmpty {
            reason = hubProblem
            whatToDo = "Fardesk reconnects by itself as soon as \(machineName) answers again."
        } else {
            reason = "\(machineName) does not answer. It may be asleep or off, Tailscale may be turned off there, or the Fardesk service there is not running."
            whatToDo = "Wake \(machineName) and check that Tailscale is on there. Fardesk reconnects by itself."
        }
    }
}

extension AppModel {
    /// The plain reason for one offline machine, read when its header is tapped (never in a view body loop).
    public func offlineReason(for machine: MachineState) -> OfflineReason {
        OfflineReason(machineName: machine.endpoint.name, hubProblem: machine.hubInfo?.problem, tailscaleIsOnHere: configuration.tailscaleIsOn())
    }
}
