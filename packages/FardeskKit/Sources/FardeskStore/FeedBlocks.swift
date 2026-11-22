import FardeskModels

/// One line of a tool block in the feed (mockups 02 and 03): a symbol, a primary verb phrase and an
/// optional secondary file name.
public struct FeedToolRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let symbolName: String
    public let isRunning: Bool
    public let isSuccess: Bool
    public let verb: String
    public let detail: String?
    public let opensDetail: Bool

    public init(tool: ToolActivity) {
        let presentation = ActivityPresentation(tool: tool)
        let kind = ToolKind(tool: tool.tool)
        id = tool.id
        symbolName = kind == .read && !presentation.isRunning && !presentation.isSuccess ? FeedSymbol.file : presentation.symbolName
        isRunning = presentation.isRunning
        isSuccess = presentation.isSuccess
        (verb, detail) = Self.split(Self.readable(tool.title, isRunning: presentation.isRunning), splitsFile: kind == .edit || kind == .read)
        opensDetail = tool.hasDetail
    }

    public init(files: FilesActivity) {
        id = files.id
        symbolName = FeedSymbol.edit
        isRunning = false
        isSuccess = false
        (verb, detail) = Self.split(files.title, splitsFile: true)
        opensDetail = true
    }

    /// The daemon writes "Ran swift test - 31 passed"; the app shows a middle dot and "..." while running.
    private static func readable(_ title: String, isRunning: Bool) -> String {
        let dotted = title.replacing(" - ", with: FeedSymbol.separator)
        return isRunning ? dotted + "..." : dotted
    }

    /// "Edited PaintEngine.swift" becomes verb "Edited" and file "PaintEngine.swift".
    private static func split(_ title: String, splitsFile: Bool) -> (String, String?) {
        guard splitsFile, let space = title.lastIndex(of: " ") else { return (title, nil) }
        let file = title[title.index(after: space)...]
        guard file.contains(".") || file.contains("/") else { return (title, nil) }
        return (String(title[..<space]), String(file))
    }
}

/// Consecutive tool and file rows folded into one quiet line: the feed is the conversation, the work in
/// between is only teased ("7 steps · Edited PaintEngine.swift"). Nothing opens from it.
public struct FeedSteps: Equatable, Sendable {
    public let count: Int
    /// The newest step, as the teaser's second half.
    public let latest: FeedToolRow

    public var isRunning: Bool { latest.isRunning }

    public var text: String {
        let last = [latest.verb, latest.detail].compactMap(\.self).joined(separator: " ")
        return count == 1 ? last : "\(count) steps\(FeedSymbol.separator)\(last)"
    }
}

/// One block of the feed: a bubble, prose, the teaser of the steps in between or a small line.
public enum FeedBlock: Equatable, Sendable, Identifiable {
    case user(id: String, text: String, files: [AttachedFile])
    case assistant(id: String, text: String)
    case steps(id: String, steps: FeedSteps)
    case note(id: String, symbolName: String?, text: String)

    public var id: String {
        switch self {
        case .user(let id, _, _), .assistant(let id, _), .steps(let id, _), .note(let id, _, _): id
        }
    }

    /// Folds consecutive tool and file rows into one steps teaser; every other row is its own block.
    public static func group(_ activities: [Activity]) -> [FeedBlock] {
        var blocks: [FeedBlock] = []
        for activity in activities {
            if let row = toolRow(activity) {
                if case .steps(let id, let steps)? = blocks.last {
                    blocks[blocks.count - 1] = .steps(id: id, steps: FeedSteps(count: steps.count + 1, latest: row))
                } else {
                    blocks.append(.steps(id: row.id, steps: FeedSteps(count: 1, latest: row)))
                }
            } else {
                blocks.append(block(activity))
            }
        }
        return blocks
    }

    private static func toolRow(_ activity: Activity) -> FeedToolRow? {
        switch activity {
        case .tool(let tool): FeedToolRow(tool: tool)
        case .files(let files): FeedToolRow(files: files)
        default: nil
        }
    }

    private static func block(_ activity: Activity) -> FeedBlock {
        switch activity {
        case .user(let user):
            let parts = AttachedFiles(parsing: user.text)
            return .user(id: user.id, text: parts.words, files: parts.files)
        case .assistant(let assistant): return .assistant(id: assistant.id, text: assistant.text)
        case .system(let system): return .note(id: system.id, symbolName: nil, text: system.text)
        case .permission(let permission):
            let line = ResolvedRequestPresentation(permission: permission)
            return .note(id: permission.id, symbolName: line.symbolName, text: line.text)
        case .question(let question):
            let line = ResolvedRequestPresentation(question: question)
            return .note(id: question.id, symbolName: line.symbolName, text: line.text)
        case .dialog(let dialog):
            let line = ResolvedRequestPresentation(dialog: dialog)
            return .note(id: dialog.id, symbolName: line.symbolName, text: line.text)
        case .tool(let tool): return .steps(id: tool.id, steps: FeedSteps(count: 1, latest: FeedToolRow(tool: tool)))
        case .files(let files): return .steps(id: files.id, steps: FeedSteps(count: 1, latest: FeedToolRow(files: files)))
        }
    }
}

/// The three-part line under the session title (mockups 02 to 04).
public struct SessionHeaderLine: Equatable, Sendable {
    public let leadText: String
    public let statusLabel: String
    public let tone: StateTone
    /// How this session asks for permissions ("Bypass permissions", "Ask", ...); nil when unknown.
    public let modeLabel: String?

    public init(session: SessionSummary, machineName: String, homeTag: String?) {
        modeLabel = session.permissionMode?.label
        let presentation = SessionPresentation(session: session, now: .now)
        leadText = presentation.headerLeadParts(machineName: machineName, homeTag: homeTag).joined(separator: FeedSymbol.separator)
        statusLabel = presentation.statusLabel
        tone = SessionRowGlyph(session: session).tint
    }
}

/// Symbols and separators that only the session screen uses.
public enum FeedSymbol {
    public static let separator = " \u{00B7} "
    public static let file = "doc"
    public static let edit = "pencil"
    public static let shield = "shield"
    public static let machine = "laptopcomputer"
    public static let info = "info.circle"
    public static let stop = "stop.fill"
    public static let sendArrow = "arrow.up"
}
