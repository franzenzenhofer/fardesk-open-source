import FardeskModels
import Foundation

/// One online machine whose release number is known.
public struct VersionedMachine: Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let versionText: String
    public let version: SemanticVersion
}

/// Which machines run an older release than the newest one: the machines **Update all** brings up to date, and the
/// machine the package comes from (docs/VERSIONING.md, section 5). Only online machines count: an offline one can
/// neither give nor take a package.
public struct UpdatePlan: Equatable, Sendable {
    public let source: VersionedMachine?
    public let targets: [VersionedMachine]

    public var isEmpty: Bool { targets.isEmpty }

    public init(machines: [MachineState]) {
        let known = machines.filter(\.isOnline).compactMap { state -> VersionedMachine? in
            guard let text = state.machine?.version, let version = SemanticVersion(text) else { return nil }
            return VersionedMachine(id: state.id, name: state.endpoint.name, versionText: text, version: version)
        }
        let newest = known.max { $0.version < $1.version }
        source = newest
        targets = newest.map { top in known.filter { $0.version < top.version } } ?? []
    }

    public func needsUpdate(_ machineID: UUID) -> Bool {
        targets.contains { $0.id == machineID }
    }

    /// "1 machine can be updated" / "3 machines can be updated"; nil when nothing can.
    public var summary: String? {
        guard !targets.isEmpty else { return nil }
        return targets.count == 1 ? "1 machine can be updated" : "\(targets.count) machines can be updated"
    }
}

/// How the update of one machine stands, for the screens that show it.
public enum MachineUpdateProgress: Equatable, Sendable {
    case updating
    case updated(version: String)
    case failed(message: String)

    public var text: String {
        switch self {
        case .updating: "Updating..."
        case .updated(let version): "Updated to \(version)"
        case .failed(let message): "Failed: \(message)"
        }
    }

    public var isRunning: Bool { self == .updating }
}
