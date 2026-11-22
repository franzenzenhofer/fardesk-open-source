import FardeskModels
import Foundation

/// The footer of a stopped chat (docs/design/STATES.md): one status line, then three ways on. Resume continues the
/// same conversation, Resume from summary continues from a short summary of it, Start fresh starts a new chat in the
/// same folder and Claude home. The line says how long it has stopped; the choice is the user's.
public enum StoppedFooter {
    public enum Choice: String, CaseIterable, Sendable {
        case resume, summary, fresh

        public var title: String {
            switch self {
            case .resume: "Resume"
            case .summary: "Resume from summary"
            case .fresh: "Start fresh here"
            }
        }
    }

    public static func statusLine(_ session: SessionSummary, now: Date) -> String {
        "Stopped \(UsageLabels.idle(since: session.updatedAt, now: now)) ago. You can continue it."
    }
}
