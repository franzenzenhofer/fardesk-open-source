import FardeskModels
import Foundation

extension DetailSection {
    /// The last path component: "Sources/Brush/PaintEngine.swift" reads "PaintEngine.swift".
    public var fileName: String { Self.split(title).name }

    /// The folder line under the file name; for a section without a folder, its subtitle.
    public var folderLabel: String {
        let folder = Self.split(title).folder
        return folder.isEmpty ? subtitle : folder
    }

    private static func split(_ path: String) -> (folder: String, name: String) {
        guard let slash = path.lastIndex(of: "/") else { return ("", path) }
        return (String(path[..<slash]), String(path[path.index(after: slash)...]))
    }
}

extension ActivityDetail {
    /// "Edited just now" under the diff; output blocks say "Ran".
    public func footerLabel(activityTime: Date, now: Date) -> String {
        let verb = kind == .diff ? "Edited" : "Ran"
        return "\(verb) \(RelativeTimeFormat.sentence(from: activityTime, to: now))"
    }
}

extension RelativeTimeFormat {
    /// "just now", "12s ago", "2m ago": the short form made readable inside a sentence.
    public static func sentence(from start: Date, to end: Date) -> String {
        let short = Self.short(from: start, to: end)
        return short == "Now" ? "just now" : "\(short) ago"
    }
}

/// The change that follows the one on screen: the next file of the same activity, or the next edit in the feed.
public struct NextChange: Equatable, Sendable {
    public let name: String
    public let activityID: String
    public let section: Int

    public init(name: String, activityID: String, section: Int) {
        self.name = name
        self.activityID = activityID
        self.section = section
    }

    public static func after(
        section: Int,
        of detail: ActivityDetail,
        in activities: [Activity]
    ) -> NextChange? {
        if detail.sections.indices.contains(section + 1) {
            return NextChange(name: detail.sections[section + 1].fileName, activityID: detail.activityId, section: section + 1)
        }
        guard let index = activities.firstIndex(where: { $0.id == detail.activityId }) else { return nil }
        return activities[(index + 1)...].lazy.compactMap(Self.fromFeed).first
    }

    private static func fromFeed(_ activity: Activity) -> NextChange? {
        switch activity {
        case .files(let files): NextChange(name: editedName(files.title), activityID: files.id, section: 0)
        case .tool(let tool) where tool.hasDetail && ToolKind(tool: tool.tool) == .edit:
            NextChange(name: editedName(tool.title), activityID: tool.id, section: 0)
        default: nil
        }
    }

    private static let editedPrefix = "Edited "

    private static func editedName(_ title: String) -> String {
        title.hasPrefix(editedPrefix) ? String(title.dropFirst(editedPrefix.count)) : title
    }
}

/// Whether a push notification should pop up while the app is open.
public enum PushPresentation {
    /// Silent for the session the user is looking at: its card and rows already show it.
    public static func shouldPresent(target: PushTarget?, viewing: PushTarget?) -> Bool {
        guard let target, let viewing else { return true }
        return !(target.machine == viewing.machine && target.sessionID == viewing.sessionID)
    }
}

extension SessionPresentation {
    /// "machine", "folder": the grey part of the header line, before the status.
    public func headerLeadParts(machineName: String) -> [String] { [machineName, folderLabel] }
}
