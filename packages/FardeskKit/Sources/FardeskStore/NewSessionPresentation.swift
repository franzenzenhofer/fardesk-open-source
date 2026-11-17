import FardeskModels
import Foundation

/// One machine in the segmented picker of the New Session sheet: a short label over the full name.
public struct MachineChoice: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let shortName: String
    public let fullName: String

    public init(id: UUID, shortName: String, fullName: String) {
        self.id = id
        self.shortName = shortName
        self.fullName = fullName
    }
}

/// What the user typed or picked in the New Session sheet.
public struct NewSessionDraft: Equatable, Sendable {
    public var machineID: UUID?
    public var folder = ""
    public var customFolder = ""
    public var showsOtherFolder = false
    public var usesWorktree = false
    public var modelName: String?
    public var permissionMode = PermissionMode.bypassPermissions
    public var prompt = ""
    public var description = ""

    public init() {}

    /// A machine that refuses bypassPermissions cannot be asked for it: the draft falls back to "Ask".
    public mutating func keepModeAllowed(on machine: OnlineMachine?) {
        if machine?.allowBypass == false, permissionMode == .bypassPermissions { permissionMode = .default }
    }

    /// The typed path while "Other..." is open, otherwise the picked recent folder.
    public var cwd: String { showsOtherFolder ? customFolder : folder }

    public var hasPrompt: Bool { !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var canStart: Bool { machineID != nil && !cwd.isEmpty && hasPrompt }

    public mutating func pick(folder path: String) {
        folder = path
        showsOtherFolder = false
    }

    /// A new machine brings its own folders and models: forget the old picks.
    public mutating func resetForMachine(firstFolder: String) {
        folder = firstFolder
        customFolder = ""
        showsOtherFolder = false
        modelName = nil
    }
}

public enum NewSessionPresentation {
    private static let macPrefixes = ["MacBook", "Mac mini", "Mac Studio", "Mac Pro", "iMac", "Mac"]

    /// "Mac mini Pro" reads "Pro", "Mac mini M2" reads "M2", "Linux box" reads "Linux".
    public static func shortName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let prefix = macPrefixes.first(where: { trimmed.hasPrefix($0) }) else {
            return trimmed.split(separator: " ").first.map(String.init) ?? trimmed
        }
        let rest = trimmed.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? trimmed : rest
    }

    /// Short names for the segmented picker; when two would collide, every full name is used instead.
    public static func choices(_ machines: [(id: UUID, name: String)]) -> [MachineChoice] {
        let shorts = machines.map { shortName($0.name) }
        let isUnique = Set(shorts).count == shorts.count
        return zip(machines, shorts).map {
            MachineChoice(id: $0.id, shortName: isUnique ? $1 : $0.name, fullName: $0.name)
        }
    }

    /// The machine the sheet selects: the one already chosen while it is online, else the first online one.
    public static func defaultMachine(current: UUID?, online: [UUID]) -> UUID? {
        if let current, online.contains(current) { return current }
        return online.first
    }

    /// The modes the sheet offers for a machine: bypassPermissions only while that machine allows it.
    public static func permissionModes(for machine: OnlineMachine?) -> [PermissionMode] {
        machine?.allowBypass == false ? PermissionMode.pickable.filter { $0 != .bypassPermissions } : PermissionMode.pickable
    }

    /// Why Start cannot work yet, in words; nil when a machine is online.
    public static func noMachineNotice(onlineCount: Int, hubStatus: HubStatus?) -> String? {
        guard onlineCount == 0 else { return nil }
        switch hubStatus {
        case .unreachable?: return "No machine is online: the hub does not answer. Retrying..."
        case .connecting?, .reachable?: return "No machine is online yet - connecting to the hub..."
        case nil: return "No machine is online yet - connecting..."
        }
    }

    public static func footer(machineName: String?) -> String? {
        machineName.map { "Runs on \($0)" }
    }
}
