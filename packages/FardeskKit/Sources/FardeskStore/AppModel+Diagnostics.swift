import FardeskModels
import Foundation

extension AppModel {
    /// How many queued reports the diagnostics text lists (the newest).
    static let diagnosticsReportLimit = 20

    /// A plain-text summary to paste into a bug report: app version, every machine with its state and daemon
    /// version, and the newest reports that wait to be sent. Machine addresses and tokens are left out.
    public func diagnosticsText(now: Date = Date()) -> String {
        let identity = configuration.telemetryIdentity
        var lines = [
            "Fardesk \(identity.appVersion) (\(identity.build)) on \(identity.platform)",
            "Device: \(deviceName)",
            "Mode: \(isDemo ? "demo" : isHubMode ? "hub" : "direct")",
            "Screen: \(Breadcrumbs.current)",
            "",
            "Machines (\(state.machines.count)):"
        ]
        for machine in state.machines {
            let presentation = MachinePresentation(machine: machine, now: now)
            var line = "- \(presentation.name): \(presentation.statusLabel)"
            if let since = presentation.offlineSinceLabel { line += " \(since)" }
            if let problem = presentation.problem { line += ", \(problem)" }
            if let info = machine.machine { line += ", daemon \(info.version), \(info.os.rawValue)" }
            lines.append(line)
        }
        let reports = configuration.telemetry.pending.suffix(Self.diagnosticsReportLimit)
        lines.append("")
        lines.append("Waiting reports (\(reports.count) newest of \(configuration.telemetry.pending.count)):")
        for report in reports {
            let code = report.code.map { " [\($0)]" } ?? ""
            lines.append("- \(report.at.formatted(.iso8601)) \(report.area)\(code): \(report.message)")
        }
        return lines.joined(separator: "\n")
    }
}
