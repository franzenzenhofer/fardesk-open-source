import FardeskModels

/// How a tool row in the feed is drawn: the symbol, and whether it shows a running spinner.
public struct ActivityPresentation: Equatable, Sendable {
    public let symbolName: String
    public let isRunning: Bool
    /// True for a finished test run that passed: the row is drawn with a green check.
    public let isSuccess: Bool

    public init(tool: ToolActivity) {
        isRunning = tool.status == .running
        let outcome = tool.status == .ok ? TestOutcome(tool: tool) : .none
        isSuccess = outcome == .passed
        symbolName = switch (tool.status, outcome) {
        case (.running, _): FardeskSymbol.toolRunning
        case (.error, _), (_, .failed): FardeskSymbol.toolFailed
        case (_, .passed): FardeskSymbol.testsPassed
        case (.ok, .none): ToolKind(tool: tool.tool).symbolName
        }
    }
}

/// What the title of a finished Bash row says about a test run ("Ran swift test - 31 passed").
private enum TestOutcome {
    case passed, failed, none

    init(tool: ToolActivity) {
        guard ToolKind(tool: tool.tool) == .command else { self = .none; return }
        if tool.title.hasSuffix(" passed") { self = .passed } else if tool.title.hasSuffix(" failed") { self = .failed } else { self = .none }
    }
}

/// The sticky permission card.
public struct PermissionPresentation: Equatable, Sendable {
    public let cardTitle: String
    public let summary: String
    public let cwdLabel: String
    public let requiresConfirmation: Bool

    public init(permission: PermissionActivity) {
        cardTitle = Self.cardTitle(tool: permission.tool)
        summary = permission.summary.isEmpty ? permission.title : permission.summary
        cwdLabel = FolderLabel.shortened(permission.cwd)
        requiresConfirmation = SessionAction.decide(.allow, on: permission).requiresConfirmation
    }

    private static func cardTitle(tool: String) -> String {
        switch ToolKind(tool: tool) {
        case .command: "Allow command?"
        case .edit: "Allow edit?"
        case .read, .lookup, .other: "Allow \(tool)?"
        }
    }
}

/// Actions a client can take on a session or a pending permission.
public enum SessionAction: Equatable, Sendable {
    case stop
    case kill
    case decide(PermissionDecision, on: PermissionActivity)

    /// Kill, and allowing a destructive permission, need an explicit confirmation
    /// (`--yes` in the CLI, Face ID in the app).
    public var requiresConfirmation: Bool {
        switch self {
        case .stop: false
        case .kill: true
        case .decide(let decision, let permission):
            switch decision {
            case .deny: false
            case .allow, .allowAlways: permission.destructive
            }
        }
    }
}
