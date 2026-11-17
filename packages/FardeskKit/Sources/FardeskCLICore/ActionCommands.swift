import ArgumentParser
import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

extension Workspace {
    func print(_ action: ConfirmedAction) throws {
        print(try ActionRenderer.render(action, options: options))
    }

    /// Calls the machine and prints the confirmation.
    func confirmed(
        _ action: ConfirmedAction,
        on found: ResolvedSession,
        _ call: (FardeskAPI, String) async throws -> Void
    ) async throws {
        try await self.call(found.endpoint) { try await call($0, found.session.id) }
        try print(action)
    }

    /// Calls the machine and prints the session it started or moved to.
    func started(on found: ResolvedSession, _ call: (FardeskAPI, String) async throws -> ActionResult) async throws {
        let result = try await self.call(found.endpoint) { try await call($0, found.session.id) }
        print(try ActionRenderer.renderStarted(result, machine: found.endpoint.name, options: options))
    }
}

struct ReplyCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "reply", abstract: "Send a message to a session.")
    @OptionGroup var common: SessionCommandOptions
    @Option(name: .long, help: "A picture (png jpg jpeg heic) or audio (m4a mp4 wav) file to send along. Repeatable.")
    var attach: [String] = []
    @Option(name: .long, help: "When the session is cold (cache expired, 20k+ tokens): full = send as it is, summary = summarise first, new = start fresh.")
    var resume: ResumeOption?
    @Argument(help: "The message.")
    var text: [String] = []

    func run(context: CLIContext) async throws {
        let message = text.joined(separator: " ")
        guard !message.isEmpty else { throw CLIError.usage("reply needs a message") }
        let files = try attach.map(AttachmentFile.read)
        try await common.perform(context) { workspace, found in
            let typed = OutgoingMessage(text: message)
            if files.isEmpty, typed.isClearCommand {
                return try await workspace.started(on: found) { try await $0.clear(sessionID: $1) }
            }
            if files.isEmpty, typed.isCompactCommand {
                return try await workspace.started(on: found) { try await $0.compact(sessionID: $1) }
            }
            var target = found.session.id
            if ColdSession.isCold(found.session, now: context.now()) {
                guard let resume else { throw CLIError.usage(Self.coldWarning(found.session, now: context.now())) }
                switch ColdSession.action(for: resume.choice, session: found.session) {
                case .sendAsIs: break
                case .compactThenSend:
                    target = try await workspace.call(found.endpoint) { try await $0.compact(sessionID: target) }.sessionId
                case .clearThenSend:
                    target = try await workspace.call(found.endpoint) { try await $0.clear(sessionID: target) }.sessionId
                case .newSessionWithPrompt:
                    let request = NewSessionRequest(
                        cwd: found.session.cwd, prompt: message, worktree: false, model: nil, permissionMode: found.session.permissionMode
                    )
                    let started = try await workspace.call(found.endpoint) { try await $0.newSession(request) }
                    return workspace.print(try ActionRenderer.renderStarted(started, machine: found.endpoint.name, options: workspace.options))
                }
            }
            let destination = target
            let result = try await workspace.call(found.endpoint) { api in
                var ids: [String] = []
                for file in files {
                    let stored = try await api.uploadAttachment(
                        sessionID: destination, data: file.data, mediaType: file.mediaType, filename: file.name
                    )
                    ids.append(stored.attachmentId)
                }
                return try await api.message(sessionID: destination, text: message, attachments: ids.isEmpty ? nil : ids)
            }
            try workspace.print(result.isQueued ? .queued : .sent)
        }
    }

    /// The Claude Code dialog as one warning plus the way on.
    static func coldWarning(_ session: SessionSummary, now: Date) -> String {
        ColdSession.warning(session, now: now)
            + "\nGo on with --resume full (send as it is), --resume summary (summarise first) or --resume new (start fresh)."
    }

    mutating func run() async throws { try await run(context: .current) }
}

/// How to go on with a cold session (`fardesk reply --resume`).
enum ResumeOption: String, ExpressibleByArgument, CaseIterable {
    case full, summary, new

    var choice: ColdChoice {
        switch self {
        case .full: .resume
        case .summary: .summary
        case .new: .startNew
        }
    }
}

/// A file to upload with a reply; the media type comes from the extension.
struct AttachmentFile: Sendable {
    let name: String
    let data: Data
    let mediaType: String

    static func read(_ path: String) throws -> AttachmentFile {
        let url = URL(filePath: path)
        guard let mediaType = AttachmentMediaType.forExtension(url.pathExtension) else {
            let supported = AttachmentMediaType.supportedExtensions.joined(separator: " ")
            throw CLIError.usage("--attach \(path): unsupported file type (supported: \(supported))")
        }
        guard let data = try? Data(contentsOf: url) else { throw CLIError.failed("Cannot read \(path)") }
        return AttachmentFile(name: url.lastPathComponent, data: data, mediaType: mediaType)
    }
}

struct StopCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "stop", abstract: "Interrupt what a session is doing.")
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.confirmed(.stopped, on: found) { try await $0.stop(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct KillCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "kill", abstract: "End a session's process (asks first).")
    @OptionGroup var common: SessionCommandOptions
    @Flag(name: .long, help: "Do not ask for confirmation.")
    var yes = false
    @Flag(name: .customLong("close-tab"), help: "Also close the session's terminal pane or tab.")
    var closeTab = false

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            if SessionAction.kill.requiresConfirmation, !yes,
               !context.confirm("Kill session \"\(found.session.title)\" on \(found.endpoint.name)?") {
                throw CLIError.failed("Cancelled")
            }
            let result = try await workspace.call(found.endpoint) {
                try await $0.kill(sessionID: found.session.id, closeTab: closeTab)
            }
            try workspace.print(.killed(closed: result.closed))
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct ResumeCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "resume", abstract: "Continue an ended session on its machine.")
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.started(on: found) { try await $0.resume(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct TakeoverCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "takeover", abstract: "End the terminal process of a session and continue it from here."
    )
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.started(on: found) { try await $0.takeover(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct ForkCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "fork", abstract: "Start a new session from a copy of this one.")
    @OptionGroup var common: SessionCommandOptions

    func run(context: CLIContext) async throws {
        try await common.perform(context) { workspace, found in
            try await workspace.started(on: found) { try await $0.fork(sessionID: $1) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}

struct NewCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "new", abstract: "Start a new session in a folder.")
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Option(name: .long, help: "The folder on the machine.")
    var cwd: String
    @Option(name: .long, help: "The first prompt.")
    var prompt: String
    @Flag(name: .long, help: "Work in a new git worktree.")
    var worktree = false
    @Option(name: .long, help: "Model name (the machine's default when omitted).")
    var model: String?
    @Option(name: .long, help: "Permission mode: default (ask), acceptEdits, plan, auto, dontAsk, bypassPermissions (the machine must allow it). The machine's default when omitted.")
    var mode: PermissionMode?

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let endpoint = try workspace.singleEndpoint(machine: target.machine)
        let request = NewSessionRequest(cwd: cwd, prompt: prompt, worktree: worktree, model: model, permissionMode: mode)
        let result = try await workspace.call(endpoint) { try await $0.newSession(request) }
        workspace.print(try ActionRenderer.renderStarted(result, machine: endpoint.name, options: workspace.options))
    }

    mutating func run() async throws { try await run(context: .current) }
}
