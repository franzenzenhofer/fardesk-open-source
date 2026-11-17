import ArgumentParser
import FardeskModels
import FardeskStore
import Foundation

/// `fardesk events`: what the apps and CLIs did, oldest first so the newest line is last.
public enum EventsRenderer {
    private static let header = ["TIME", "MACHINE", "KIND", "AREA", "MESSAGE", "MS", "APP"]

    static func render(_ found: [FoundReport], options: RenderOptions) throws -> String {
        try TelemetryRenderer.render(found, options: options, human: human)
    }

    static func rows(_ found: [FoundReport], options: RenderOptions) -> [[String]] {
        found.map { item in
            let report = item.report
            return [
                TelemetryRenderer.time(report.at, options: options),
                report.machine ?? item.foundOn,
                (report.kind ?? .error).rawValue,
                report.area,
                TextTable.oneLine(report.message),
                report.durationMs.map(String.init) ?? "-",
                "\(report.appVersion) (\(report.platform))",
            ]
        }
    }

    /// New rows while following: no header, the same columns.
    static func renderFollowed(_ found: [FoundReport], options: RenderOptions) throws -> String {
        guard options.format == .human else { return try render(found, options: options) }
        let rows = rows(found, options: options)
        let widths = TextTable.widths(of: rows)
        return rows.map { TextTable.format($0, widths: widths) }.joined(separator: "\n")
    }

    private static func human(_ found: [FoundReport], options: RenderOptions) -> String {
        guard !found.isEmpty else { return "No events reported" }
        return TextTable.render(header: header, rows: rows(found, options: options)).joined(separator: "\n")
    }
}

struct EventsCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "events", abstract: "List what the apps and CLIs did, events and errors, newest last."
    )
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Option(name: .long, help: "How far back: 90s, 30m, 1h, 2d, or an ISO 8601 time. Default 1h.")
    var since = "1h"
    @Flag(name: .long, help: "Keep running and print new events as they arrive.")
    var follow = false
    @Option(name: .long, help: "With --follow: stop after this many seconds (default: run until interrupted).")
    var timeout: Int?
    @Option(name: .long, help: "At most this many rows at the start.")
    var limit: Int = 200
    @Flag(name: .long, help: "Also show the `help` and `--help` runs of the CLI itself.")
    var all = false

    static let pollInterval: Duration = .seconds(2)

    /// A `fardesk help` or `--help` run of the CLI itself: logged, but hidden unless --all.
    static func isHelpNoise(_ report: TelemetryReport) -> Bool {
        guard report.area == "cli.command" else { return false }
        let words = report.message.split(separator: " ")
        return words.dropFirst().first == "help" || words.contains("--help")
    }

    private func visible(_ found: [FoundReport]) -> [FoundReport] {
        all ? found : found.filter { !Self.isHelpNoise($0.report) }
    }

    func validate() throws {
        guard (1...TelemetryBatch.maxReports).contains(limit) else {
            throw ValidationError("--limit must be between 1 and \(TelemetryBatch.maxReports).")
        }
        guard timeout == nil || follow else { throw ValidationError("--timeout only applies with --follow.") }
    }

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let start = try SinceOption.parse(since, now: context.now())
        var shown = visible(try await workspace.collectReports(machine: target.machine, since: start, limit: limit, kind: nil))
        let initial = Array(shown.reversed())
        if !initial.isEmpty || !follow { workspace.print(try EventsRenderer.render(initial, options: workspace.options)) }
        guard follow else { return }
        var seen = Set(shown.map(\.report.id))
        var newest = shown.first?.report.at ?? start
        let deadline = timeout.map { ContinuousClock.now + .seconds($0) }
        while deadline.map({ ContinuousClock.now < $0 }) ?? true {
            try await Task.sleep(for: Self.pollInterval)
            shown = visible(try await workspace.collectReports(machine: target.machine, since: newest, limit: limit, kind: nil))
            let fresh = shown.filter { seen.insert($0.report.id).inserted }.reversed() as [FoundReport]
            newest = shown.first?.report.at ?? newest
            if !fresh.isEmpty { workspace.print(try EventsRenderer.renderFollowed(fresh, options: workspace.options)) }
        }
    }

    mutating func run() async throws { try await run(context: .current) }
}
