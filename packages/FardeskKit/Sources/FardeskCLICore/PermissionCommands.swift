import ArgumentParser
import FardeskModels
import FardeskStore
import Foundation

/// The pending permission or question a command acts on.
private enum PendingKind {
    case permission
    case question
}

extension Workspace {
    /// The newest rows of the session, to find what is waiting for the human.
    private static let pendingScanLimit = 200

    fileprivate func pending(_ kind: PendingKind, in found: ResolvedSession, requestID: String?) async throws -> FardeskModels.Activity {
        let page = try await call(found.endpoint) {
            try await $0.activity(sessionID: found.session.id, limit: Self.pendingScanLimit)
        }
        let candidates = SessionFeed(page: page).pendingRequests.filter { matches($0, kind) }
        if let requestID {
            guard let hit = candidates.first(where: { Self.requestID(of: $0) == requestID }) else {
                throw CLIError.failed("No pending request \(requestID) in \"\(found.session.title)\"")
            }
            return hit
        }
        guard let only = candidates.first, candidates.count == 1 else {
            let ids = candidates.map(Self.requestID).joined(separator: ", ")
            throw CLIError.failed(
                candidates.isEmpty
                    ? "Nothing is waiting in \"\(found.session.title)\""
                    : "Several requests are waiting (\(ids)): pass the request id"
            )
        }
        return only
    }

    private func matches(_ activity: FardeskModels.Activity, _ kind: PendingKind) -> Bool {
        switch (activity, kind) {
        case (.permission, .permission), (.question, .question): true
        default: false
        }
    }

    private static func requestID(of activity: FardeskModels.Activity) -> String {
        switch activity {
        case .permission(let permission): permission.requestId
        case .question(let question): question.requestId
        default: ""
        }
    }

    fileprivate func decide(
        _ decision: PermissionDecision,
        on found: ResolvedSession,
        requestID: String?,
        assumeYes: Bool
    ) async throws {
        guard case .permission(let permission) = try await pending(.permission, in: found, requestID: requestID) else { return }
        if SessionAction.decide(decision, on: permission).requiresConfirmation, !assumeYes,
           !context.confirm("Allow destructive request \"\(permission.title)\" on \(found.endpoint.name)?") {
            throw CLIError.failed("Cancelled")
        }
        try await confirmed(.decided(decision), on: found) {
            try await $0.decide(sessionID: $1, requestID: permission.requestId, decision: decision)
        }
    }
}

struct ApproveCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "approve", abstract: "Allow a pending permission request.")
    @OptionGroup var common: SessionCommandOptions
    @Argument(help: "The request id (needed only when several are waiting).")
    var requestID: String?
    @Flag(name: .long, help: "Also allow this kind of request from now on.")
    var always = false
    @Flag(name: .long, help: "Do not ask before allowing a destructive request.")
    var yes = false

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.decide(always ? .allowAlways : .allow, on: found, requestID: requestID, assumeYes: yes)
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct DenyCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "deny", abstract: "Refuse a pending permission request.")
    @OptionGroup var common: SessionCommandOptions
    @Argument(help: "The request id (needed only when several are waiting).")
    var requestID: String?

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.decide(.deny, on: found, requestID: requestID, assumeYes: false)
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct AnswerCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "answer", abstract: "Answer a pending question.")
    @OptionGroup var common: SessionCommandOptions
    @Argument(help: "The option to pick.")
    var option: String
    @Argument(help: "The request id (needed only when several are waiting).")
    var requestID: String?

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            guard case .question(let question) = try await workspace.pending(.question, in: found, requestID: requestID)
            else { return }
            try await workspace.confirmed(.answered(option), on: found) {
                try await $0.answer(sessionID: $1, requestID: question.requestId, option: option)
            }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}
