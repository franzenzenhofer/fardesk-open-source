import FardeskModels

/// A question or permission whose time ran out: Claude Code shows its dialog at the computer. The session keeps showing
/// what the dialog asks, marked "waiting at the computer", and offers answer buttons only when the daemon can type them
/// into the terminal (`typable`); otherwise it says to answer at the computer.
public struct TerminalRequestPresentation: Equatable, Sendable {
    public enum Choice: Hashable, Sendable {
        case option(String)
        case allow
        case deny
    }

    public static let title = "Waiting at the computer"
    public static let answerAtComputer = "Answer at the computer"

    public let requestID: String
    /// The question, or the tool with a short summary of its input.
    public let text: String
    /// The options of a question, for reading; tapping is only possible through `choices`.
    public let options: [String]
    /// What a tap can send: the option labels of a question, or Allow and Deny. Empty when the daemon cannot type the answer.
    public let choices: [Choice]
    public let isPermission: Bool

    public var footnote: String? { choices.isEmpty ? Self.answerAtComputer : nil }

    public init?(_ activity: Activity) {
        switch activity {
        case .question(let question) where question.state == .terminal:
            requestID = question.requestId
            text = question.text
            options = question.options
            choices = question.typable == true ? question.options.map(Choice.option) : []
            isPermission = false
        case .permission(let permission) where permission.state == .terminal:
            requestID = permission.requestId
            text = permission.summary.isEmpty ? permission.title : "\(permission.tool): \(permission.summary)"
            options = []
            choices = permission.typable == true ? [.deny, .allow] : []
            isPermission = true
        default:
            return nil
        }
    }
}
