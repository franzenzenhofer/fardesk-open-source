/// The coding agent behind a session. Claude Code today; Codex sessions come with their own daemon support.
public enum AgentKind: String, TolerantEnum, CaseIterable {
    case claude, codex, unknown

    /// The plain name a non-specialist knows.
    public var displayName: String {
        switch self {
        case .claude: "Claude"
        case .codex: "Codex"
        case .unknown: "Unknown agent"
        }
    }
}

public enum SessionStatus: String, TolerantEnum {
    case working, waiting, idle, ended, unknown
}

/// What a waiting session needs. A permission or question is a request the phone can answer; a terminal wait is a
/// dialog open at the computer that only the terminal can answer.
public enum WaitingReason: String, TolerantEnum {
    case permission, question, dialog, terminal, unknown

    /// The phone can answer it, so a message typed meanwhile waits for that answer.
    public var phoneCanAnswer: Bool { self != .terminal }
}

public enum ReplyMode: String, TolerantEnum {
    case composer, takeover, resume, unknown
}

public enum ToolStatus: String, TolerantEnum {
    case running, ok, error, unknown
}

public enum PermissionState: String, TolerantEnum {
    case pending, allowed, denied, expired, unknown
    /// Not answered in time: the dialog waits at the computer (the phone may still answer it when `typable`).
    case terminal
}

public enum QuestionState: String, TolerantEnum {
    case pending, answered, expired, terminal, unknown
}

public enum PermissionDecision: String, TolerantEnum {
    case allow, deny, unknown
    case allowAlways = "allow_always"
    /// Plan approval (ExitPlanMode): the three choices of Claude Code's "Ready to code?" dialog.
    case approveBypass = "approve_bypass"
    case approveManual = "approve_manual"
    case revise
}

public enum MachineOS: String, TolerantEnum {
    case macos, linux, unknown
}

public enum APNsEnvironment: String, TolerantEnum {
    case sandbox, production, unknown
}

public enum NotificationType: String, TolerantEnum {
    case done, permission, question, ended, unknown
}

public enum ErrorCode: String, TolerantEnum {
    case unauthorized, conflict, unsupported, `internal`, unknown
    case tokenRevoked = "token_revoked"
    case rateLimited = "rate_limited"
    case forbidden
    case invalidRequest = "invalid_request"
    case notFound = "not_found"
    case machineOffline = "machine_offline"
    case tailscaleUnavailable = "tailscale_unavailable"
    case deviceMoved = "device_moved"
    case masterTokenWrongNode = "master_token_wrong_node"
}

public enum DetailKind: String, TolerantEnum {
    case diff, output, unknown
}

public enum DiffSign: String, TolerantEnum {
    case context = " "
    case added = "+"
    case removed = "-"
    case unknown = "?"
}
