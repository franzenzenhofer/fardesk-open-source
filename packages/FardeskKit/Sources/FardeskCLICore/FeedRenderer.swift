import FardeskModels
import FardeskStore
import Foundation

/// `fardesk activity`: one line per row. `--json` prints one compact contract object per line.
public enum FeedRenderer {
    public static func render(_ activities: [Activity], options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try activities.map { try JSONOutput.compact($0) }.joined(separator: "\n")
        case .human: activities.map { line($0, options: options) }.joined(separator: "\n")
        }
    }

    public static func line(_ activity: Activity, options: RenderOptions) -> String {
        let (marker, text) = body(activity)
        let clock = clockTime(activity.timestamp, in: options.timeZone)
        return "\(clock) \(marker) \(TextTable.oneLine(text))"
    }

    static func clockTime(_ date: Date, in timeZone: TimeZone) -> String {
        date.formatted(
            .verbatim(
                "\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits):\(second: .twoDigits)",
                timeZone: timeZone,
                calendar: Calendar(identifier: .gregorian)
            )
        )
    }

    private static func body(_ activity: Activity) -> (marker: String, text: String) {
        switch activity {
        case .user(let a): (">", a.text)
        case .assistant(let a): ("<", a.text)
        case .system(let a): ("#", a.text)
        case .files(let a): ("~", a.title)
        case .tool(let a): ("$", "\(a.title) (\(a.status.rawValue))")
        case .question(let a): ("?", question(a))
        case .permission(let a): ("!", permission(a))
        }
    }

    private static func question(_ a: QuestionActivity) -> String {
        let options = a.options.isEmpty ? "" : " [\(a.options.joined(separator: " | "))]"
        return "\(a.text)\(options) \(requestState(a.state.rawValue, id: a.requestId, pending: a.state == .pending))"
    }

    private static func permission(_ a: PermissionActivity) -> String {
        let what = [a.title, a.summary].filter { !$0.isEmpty }.joined(separator: " - ")
        let destructive = a.destructive ? " DESTRUCTIVE" : ""
        let state = requestState(a.state.rawValue, id: a.requestId, pending: a.state == .pending)
        return "\(what)\(destructive) \(state)"
    }

    /// Pending requests show their request id so the user can approve, deny or answer them.
    private static func requestState(_ state: String, id: String, pending: Bool) -> String {
        pending ? "[\(state) \(id)]" : "[\(state)]"
    }
}
