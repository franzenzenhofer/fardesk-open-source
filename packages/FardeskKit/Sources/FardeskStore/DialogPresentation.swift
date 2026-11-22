import FardeskModels
import Foundation

/// How a dialog Claude Code asks is shown: its own title and words, one button per choice it offers. The app only
/// words it; it never decides which choice is right.
public struct DialogPresentation: Equatable, Sendable {
    public struct Button: Equatable, Sendable, Identifiable {
        /// The choice sent back to the daemon.
        public let answer: String
        public let title: String
        public let isFocused: Bool

        public var id: String { answer }
    }

    public static let coldResumeKind = "cold_resume_quota"
    static let unknownKindText = "Claude Code asks something this app version cannot show. Answer at the computer or update the app."

    public let title: String
    public let text: String
    public let buttons: [Button]

    public init(_ dialog: DialogActivity, now: Date) {
        if dialog.dialogKind == Self.coldResumeKind {
            title = "Resume this conversation?"
            text = Self.coldResumeText(dialog.payload, now: now)
            let focused = dialog.payload["focusedAction"]?.string
            buttons = dialog.choices.map { Button(answer: $0, title: Self.buttonTitle($0), isFocused: $0 == focused) }
        } else {
            title = "Claude Code asks"
            text = Self.unknownKindText
            buttons = dialog.choices.filter { $0 == Self.dismiss }.map { Button(answer: $0, title: Self.buttonTitle($0), isFocused: false) }
        }
    }

    private static let dismiss = "dismiss"

    static func buttonTitle(_ choice: String) -> String {
        switch choice {
        case "resume": "Resume"
        case "new_conversation": "Start a new conversation"
        case "compact": "Resume from summary"
        case dismiss: "Not now"
        default: choice
        }
    }

    /// "This conversation has been inactive for 3 h and is 426k tokens long. Resuming it will use about 12% of your
    /// 5-hour usage limit." Each half is left out when the payload does not carry its numbers.
    static func coldResumeText(_ payload: [String: JSONValue], now: Date) -> String {
        var sentences: [String] = []
        if let since = payload["inactiveSince"]?.number, let tokens = payload["contextTokens"]?.number {
            let idle = UsageLabels.idle(since: Date(timeIntervalSince1970: since / 1_000), now: now)
            sentences.append("This conversation has been inactive for \(idle) and is \(UsageLabels.tokens(Int(tokens))) tokens long.")
        }
        if let percent = payload["percentOfFiveHourLimit"]?.number {
            sentences.append("Resuming it will use about \(Int(percent.rounded()))% of your 5-hour usage limit.")
        }
        return sentences.joined(separator: " ")
    }
}
