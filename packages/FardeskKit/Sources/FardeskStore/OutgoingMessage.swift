import Foundation

/// A picture or voice recording that goes along with a message.
public struct OutgoingAttachment: Sendable {
    public enum Source: Sendable {
        case data(Data)
        /// Read at send time, so an unreadable file is reported with the machine and the action.
        case file(URL)
    }

    public let source: Source
    public let mediaType: String
    public let filename: String

    public init(source: Source, mediaType: String, filename: String) {
        self.source = source
        self.mediaType = mediaType
        self.filename = filename
    }

    func bytes() throws -> Data {
        switch source {
        case .data(let data): data
        case .file(let url): try Data(contentsOf: url)
        }
    }
}

/// What the composer sends: text and attachments (either may be empty, not both).
public struct OutgoingMessage: Sendable {
    /// Sent when only attachments were given: the daemon needs some text.
    public static let attachmentsOnlyText = "See attached."

    public let text: String
    public let attachments: [OutgoingAttachment]

    public init(text: String, attachments: [OutgoingAttachment] = []) {
        self.text = text
        self.attachments = attachments
    }

    /// Typing exactly `/clear` (nothing else) asks for a fresh conversation instead of sending text.
    public static let clearCommand = "/clear"
    public static let compactCommand = "/compact"

    public var isCompactCommand: Bool {
        attachments.isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines) == Self.compactCommand
    }

    public var isClearCommand: Bool {
        attachments.isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines) == Self.clearCommand
    }

    /// The text to send: the typed text, or a short line when there are only attachments.
    var textToSend: String {
        let blank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return blank && !attachments.isEmpty ? Self.attachmentsOnlyText : text
    }
}
