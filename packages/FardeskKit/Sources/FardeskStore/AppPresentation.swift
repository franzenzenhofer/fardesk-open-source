import FardeskModels
import Foundation

extension SessionPresentation {
    private static let separator = " \u{00B7} "

    /// The grey line under a session title in the list.
    public var subtitle: String { subtitleParts.joined(separator: Self.separator) }

    /// "machine - folder - status": the line under the session title.
    public func headerSubtitle(machineName: String) -> String {
        (headerLeadParts(machineName: machineName) + [statusLabel]).joined(separator: Self.separator)
    }
}

/// A permission or question row that is no longer pending: one compact line in the feed.
public struct ResolvedRequestPresentation: Equatable, Sendable {
    public let symbolName: String
    public let text: String

    public init(permission: PermissionActivity) {
        symbolName = permission.state == .denied ? FardeskSymbol.permissionDenied : FardeskSymbol.permissionAllowed
        text = "\(permission.title) (\(permission.state.rawValue))"
    }

    public init(question: QuestionActivity) {
        symbolName = FardeskSymbol.question
        text = "\(question.text) (\(question.state.rawValue))"
    }

    public init(dialog: DialogActivity) {
        symbolName = FardeskSymbol.question
        text = "\(DialogPresentation(dialog, now: dialog.ts).title) (\(dialog.state?.rawValue ?? "pending"))"
    }
}

extension ActivityDetail {
    /// The whole detail as plain text, for the share sheet.
    public var plainText: String {
        sections.map { section in
            let header = "\(section.title) (+\(section.added) -\(section.removed))"
            let body = section.lines.map { "\($0.sign.rawValue)\($0.text)" }
            return ([header] + body).joined(separator: "\n")
        }.joined(separator: "\n\n")
    }

    public var screenTitle: String { kind == .diff ? "Changes" : "Output" }
}

/// Which push notification types this device wants, kept in `UserDefaults` (on by default).
public struct NotificationPreferences: Sendable {
    public static let allTypes: [NotificationType] = [.done, .permission, .question, .ended]

    public static func key(for type: NotificationType) -> String { "notify.\(type.rawValue)" }

    public static func label(for type: NotificationType) -> String {
        switch type {
        case .done: "Session done"
        case .permission: "Needs approval"
        case .question: "Needs answer"
        case .ended: "Session ended"
        case .unknown: unknownStateText
        }
    }

    nonisolated(unsafe) private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var enabled: [NotificationType] {
        Self.allTypes.filter { defaults.object(forKey: Self.key(for: $0)) as? Bool ?? true }
    }
}

extension AppModel {
    /// Clears the error the alert showed.
    public func dismissError() {
        lastError = nil
    }
}
