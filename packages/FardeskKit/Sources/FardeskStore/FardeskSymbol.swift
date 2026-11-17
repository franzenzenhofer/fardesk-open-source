/// The one table of SF Symbol names used by the app (the CLI uses ASCII markers instead).
public enum FardeskSymbol {
    // Session status (mockup 01)
    public static let waiting = "exclamationmark.circle.fill"
    public static let working = "circle.dotted"
    public static let idle = "pause.circle.fill"
    public static let ended = "checkmark.circle"

    // Tool rows (SPEC 4.2)
    public static let edit = "pencil"
    public static let command = "terminal"
    public static let read = "doc.text.magnifyingglass"
    public static let lookup = "folder"
    public static let toolOK = "checkmark.circle"
    public static let testsPassed = "checkmark.circle.fill"
    public static let toolFailed = "xmark.octagon"
    public static let toolRunning = "circle.dotted"

    // Requests and cards
    public static let permission = "lock.shield"
    public static let permissionAllowed = "checkmark.shield"
    public static let permissionDenied = "xmark.shield"
    public static let question = "questionmark.bubble"
    public static let files = "doc.on.doc"
    public static let send = "arrow.up.circle.fill"
    public static let stop = "stop.fill"
}

/// Groups tool names into the kinds that share a symbol.
enum ToolKind {
    case command, edit, read, lookup, other

    init(tool: String) {
        switch tool {
        case "Bash": self = .command
        case "Edit", "MultiEdit", "Write", "NotebookEdit": self = .edit
        case "Read": self = .read
        case "Grep", "Glob", "LS": self = .lookup
        default: self = .other
        }
    }

    var symbolName: String {
        switch self {
        case .command: FardeskSymbol.command
        case .edit: FardeskSymbol.edit
        case .read: FardeskSymbol.read
        case .lookup: FardeskSymbol.lookup
        case .other: FardeskSymbol.toolOK
        }
    }
}
