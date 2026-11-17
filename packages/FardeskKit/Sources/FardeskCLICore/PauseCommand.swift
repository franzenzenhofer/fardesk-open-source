import ArgumentParser
import FardeskClient
import FardeskModels
import FardeskStore
import Foundation

/// What one machine answered to a pause request.
struct PauseLine: Sendable {
    let machine: String
    let pausedUntil: Date?
    let problem: String?
}

/// `fardesk pause`: one line per machine.
public enum PauseRenderer {
    private struct Entry: Encodable {
        let machine: String
        let pausedUntil: Date?
        let problem: String?
    }

    static func render(_ lines: [PauseLine], options: RenderOptions) throws -> String {
        switch options.format {
        case .json:
            try JSONOutput.compact(lines.map { Entry(machine: $0.machine, pausedUntil: $0.pausedUntil, problem: $0.problem) })
        case .human:
            lines.map { text($0, options: options) }.joined(separator: "\n")
        }
    }

    private static func text(_ line: PauseLine, options: RenderOptions) -> String {
        if let problem = line.problem { return "\(line.machine): \(problem)" }
        guard let until = line.pausedUntil else { return "\(line.machine): notifications on" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = options.timeZone
        return "\(line.machine): paused until \(PausePresentation.clock(until, calendar: calendar))"
    }
}

struct PauseCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "pause", abstract: "Pause the push notifications of every machine (default 60 minutes; `off` resumes)."
    )
    @OptionGroup var output: OutputOptions
    @OptionGroup var target: MachineOption
    @Argument(help: "Minutes (0 to 10080) or `off`.")
    var duration: String = "60"

    static let maxMinutes = 10_080

    static func minutes(_ text: String) throws -> Int {
        if text == "off" { return 0 }
        guard let value = Int(text), (0...maxMinutes).contains(value) else {
            throw ValidationError("Give minutes between 0 and \(maxMinutes), or `off`.")
        }
        return value
    }

    func validate() throws { _ = try Self.minutes(duration) }

    func run(context: CLIContext) async throws {
        let workspace = try await Workspace.open(context: context, format: output.format)
        let minutes = try Self.minutes(duration)
        var lines: [PauseLine] = []
        for endpoint in try workspace.endpoints(machine: target.machine) {
            do {
                let state = try await workspace.call(endpoint, quick: true) { try await $0.pauseNotifications(minutes: minutes) }
                lines.append(PauseLine(machine: endpoint.name, pausedUntil: state.pausedUntil, problem: nil))
            } catch {
                lines.append(PauseLine(machine: endpoint.name, pausedUntil: nil, problem: error.localizedDescription))
            }
        }
        workspace.print(try PauseRenderer.render(lines, options: workspace.options))
        guard lines.contains(where: { $0.problem == nil }) else { throw CLIError.failed("No machine took the change") }
    }

    mutating func run() async throws { try await run(context: .current) }
}
