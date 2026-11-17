import ArgumentParser
import FardeskModels
import FardeskStore
import Foundation

/// A report and the machine it was found on.
struct FoundReport: Sendable {
    let report: TelemetryReport
    let foundOn: String
}

/// Parses `--since`: a full ISO 8601 time (with or without fractions) or a plain date (UTC midnight).
enum SinceOption {
    /// `90s`, `30m`, `1h`, `2d` (back from `now`), or an ISO 8601 time or date.
    static func parse(_ text: String, now: Date) throws -> Date {
        let units: [Character: TimeInterval] = ["s": 1, "m": 60, "h": 3_600, "d": 86_400]
        if let unit = text.last, let seconds = units[unit], let count = Double(text.dropLast()), count >= 0 {
            return now.addingTimeInterval(-count * seconds)
        }
        return try parse(text)
    }

    static func parse(_ text: String) throws -> Date {
        let styles: [Date.ISO8601FormatStyle] = [
            .init(includingFractionalSeconds: true),
            .init(),
            .init(timeZone: .gmt).year().month().day(),
        ]
        for style in styles {
            if let date = try? style.parse(text) { return date }
        }
        throw CLIError.usage("--since must be an ISO 8601 time like 2026-11-15T09:30:00Z")
    }
}

extension Workspace {
    /// The reports of every selected machine, one copy per id, newest first.
    func collectReports(
        machine: String?,
        since: Date?,
        limit: Int?,
        kind: TelemetryKind?
    ) async throws -> [FoundReport] {
        var byID: [String: FoundReport] = [:]
        for endpoint in try telemetryEndpoints(machine: machine) {
            do {
                let list = try await call(endpoint, quick: true) { try await $0.telemetry(since: since, limit: limit, kind: kind) }
                for report in list.reports where byID[report.id] == nil {
                    byID[report.id] = FoundReport(report: report, foundOn: endpoint.name)
                }
            } catch {
                report(MachineProblem(machine: endpoint.name, error: error))
            }
        }
        let newestFirst = byID.values.sorted { $0.report.at > $1.report.at }
        return limit.map { Array(newestFirst.prefix($0)) } ?? newestFirst
    }
}

struct ErrorsCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "errors",
        abstract: "List the errors the apps reported (all machines, newest first), or report one."
    )
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Option(name: .long, help: "Only errors at or after this ISO 8601 time.")
    var since: String?
    @Option(name: .long, help: "At most this many errors.")
    var limit: Int?
    @Option(name: .long, help: "Report this message as an error instead of listing.")
    var report: String?

    func validate() throws {
        if report != nil, since != nil || limit != nil {
            throw ValidationError("--report sends one error; it cannot be combined with --since or --limit.")
        }
        if let limit, !(1...TelemetryBatch.maxReports).contains(limit) {
            throw ValidationError("--limit must be between 1 and \(TelemetryBatch.maxReports).")
        }
    }

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        if let report { return try await send(report, workspace) }
        let sinceDate = try since.map(SinceOption.parse)
        let found = try await workspace.collectReports(machine: target.machine, since: sinceDate, limit: limit, kind: .error)
        workspace.print(try TelemetryRenderer.render(found, options: workspace.options))
    }

    private func send(_ message: String, _ workspace: Workspace) async throws {
        let endpoint = try workspace.reportEndpoint(machine: target.machine)
        let report = TelemetryReport(
            at: workspace.context.now(),
            message: message,
            area: "cli",
            appVersion: FardeskCLI.version,
            build: FardeskCLI.build,
            platform: "cli",
            machine: workspace.access.hub == nil ? endpoint.name : nil
        )
        let result = try await workspace.call(endpoint) { try await $0.reportTelemetry([report]) }
        workspace.print(try TelemetryRenderer.renderReported(result, options: workspace.options))
    }

    mutating func run() async throws { try await run(context: .current) }
}

/// `fardesk errors`: machine, time, area, message, app version and build.
public enum TelemetryRenderer {
    private static let header = ["MACHINE", "TIME", "AREA", "MESSAGE", "APP"]

    static func render(_ found: [FoundReport], options: RenderOptions) throws -> String {
        try render(found, options: options, human: human)
    }

    /// The JSON of the reports, or the given human text; `fardesk errors` and `fardesk events` share it.
    static func render(
        _ found: [FoundReport],
        options: RenderOptions,
        human: ([FoundReport], RenderOptions) -> String
    ) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(found.map(\.report))
        case .human: human(found, options)
        }
    }

    static func renderReported(_ result: TelemetryResult, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(result)
        case .human: "Reported"
        }
    }

    private static func human(_ found: [FoundReport], options: RenderOptions) -> String {
        guard !found.isEmpty else { return "No errors reported" }
        let rows = found.map { item in
            [
                item.report.machine ?? item.foundOn,
                time(item.report.at, options: options),
                item.report.area,
                TextTable.oneLine(item.report.message),
                "\(item.report.appVersion) (\(item.report.build))",
            ]
        }
        return TextTable.render(header: header, rows: rows).joined(separator: "\n")
    }

    static func time(_ date: Date, options: RenderOptions) -> String {
        date.formatted(
            Date.VerbatimFormatStyle(
                format: "\(year: .defaultDigits)-\(month: .twoDigits)-\(day: .twoDigits) \(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits):\(second: .twoDigits)",
                locale: Locale(identifier: "en_US_POSIX"),
                timeZone: options.timeZone,
                calendar: Calendar(identifier: .gregorian)
            )
        )
    }
}
