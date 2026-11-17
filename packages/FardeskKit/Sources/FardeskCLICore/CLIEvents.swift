import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// The CLI's own telemetry: in hub mode every command run is one event (which command, how long,
/// how it ended), queued in a small file and sent to the hub when the command ends. Never any
/// argument values: a prompt or a password must not end up in a log.
enum CLIEvents {
    static let flushTimeout: TimeInterval = 3

    static func record(arguments: [String], status: Int32, started: Date, context: CLIContext) async {
        let machinesFile = MachineListFile(url: MachineListFile.defaultURL(environment: context.environment, home: context.home))
        guard let list = try? machinesFile.load(), let hub = list.hub else { return }
        let queue = TelemetryQueue(file: machinesFile.url.deletingLastPathComponent().appending(path: "cli-telemetry-queue.json"))
        queue.enqueue(report(arguments: arguments, status: status, started: started, context: context))
        let tokens = TokenStore.file(url: TokenStore.defaultFileURL(environment: context.environment, home: context.home))
        let access = MachineAccess(tokens: tokens, timeout: flushTimeout, hub: hub)
        guard let endpoint = access.hubEndpoint, let api = try? access.api(for: endpoint) else { return }
        let batch = Array(queue.pending.prefix(TelemetryBatch.maxReports))
        guard (try? await api.reportTelemetry(batch)) != nil else { return }
        queue.remove(ids: Set(batch.map(\.id)))
    }

    /// `fardesk <command> [flag names]` and the exit status.
    static func report(arguments: [String], status: Int32, started: Date, context: CLIContext) -> TelemetryReport {
        let words = arguments.filter { $0.hasPrefix("--") ? !$0.contains("=") : !$0.hasPrefix("-") }
        let command = words.first { !$0.hasPrefix("-") } ?? "help"
        let flags = words.filter { $0.hasPrefix("--") }
        return TelemetryReport(
            at: context.now(),
            message: (["fardesk", command] + flags).joined(separator: " ") + " -> exit \(status)",
            area: "cli.command",
            appVersion: FardeskCLI.version,
            build: FardeskCLI.build,
            platform: "cli \(context.hostName)",
            kind: .event,
            durationMs: max(0, Int((context.now().timeIntervalSince(started) * 1000).rounded()))
        )
    }
}
