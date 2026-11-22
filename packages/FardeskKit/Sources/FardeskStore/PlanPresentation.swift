import FardeskModels

/// The "Ready to code?" card of a session that finished planning (ExitPlanMode), in Claude Code's words and order.
public struct PlanPresentation: Equatable, Sendable {
    public enum Choice: String, CaseIterable, Equatable, Sendable {
        case approveBypass = "approve_bypass"
        case approveManual = "approve_manual"
        case revise

        public var title: String {
            switch self {
            case .approveBypass: "Yes, and bypass permissions"
            case .approveManual: "Yes, manually approve edits"
            case .revise: "Tell Claude what to change"
            }
        }

        public var decision: PermissionDecision {
            switch self {
            case .approveBypass: .approveBypass
            case .approveManual: .approveManual
            case .revise: .revise
            }
        }
    }

    public static let title = "Ready to code?"

    public let plan: String
    /// Empty when the machine sent no choices (an older daemon): the card then falls back to Allow and Deny.
    public let choices: [Choice]

    /// Nil unless the request carries a plan.
    public init?(permission: PermissionActivity) {
        guard let plan = permission.plan, !plan.isEmpty else { return nil }
        self.plan = plan
        let offered = Set(permission.planChoices ?? [])
        choices = Choice.allCases.filter { offered.contains($0.rawValue) }
    }

    public var offersChoices: Bool { !choices.isEmpty }
}
