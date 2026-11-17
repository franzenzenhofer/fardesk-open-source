import FardeskModels
import FardeskStore
import Foundation

/// `fardesk login`: one line per machine.
public enum LoginRenderer {
    private struct Row: Encodable {
        let machine: String
        let url: String
        let status: String
        let message: String?
    }

    public static func render(_ results: [MachineLoginResult], options: RenderOptions) throws -> String {
        let rows = results.map(row)
        switch options.format {
        case .json: return try JSONOutput.compact(rows)
        case .human:
            return TextTable.render(
                header: ["MACHINE", "RESULT"],
                rows: rows.map { [$0.machine, $0.message ?? "logged in"] }
            ).joined(separator: "\n")
        }
    }

    private static func row(_ result: MachineLoginResult) -> Row {
        let (status, message) = describe(result.status)
        return Row(machine: result.endpoint.name, url: result.endpoint.url.absoluteString, status: status, message: message)
    }

    private static func describe(_ status: LoginStatus) -> (String, String?) {
        switch status {
        case .success: ("success", nil)
        case .wrongPassword: ("wrong_password", "wrong password")
        case .rateLimited: ("rate_limited", "too many attempts, try again later")
        case .unreachable(let why): ("unreachable", "unreachable: \(why)")
        case .failed(let why): ("failed", "failed: \(why)")
        }
    }
}

/// `fardesk logout` and `fardesk rotate-password`: one line per machine, with a problem when there was one.
public enum PerMachineRenderer {
    public struct Line: Sendable, Equatable {
        public let machine: String
        public let problem: String?

        public init(machine: String, problem: String?) {
            self.machine = machine
            self.problem = problem
        }
    }

    private struct Row: Encodable {
        let machine: String
        let ok: Bool
        let problem: String?
    }

    public static func render(_ lines: [Line], done: String, options: RenderOptions) throws -> String {
        switch options.format {
        case .json:
            return try JSONOutput.compact(lines.map { Row(machine: $0.machine, ok: $0.problem == nil, problem: $0.problem) })
        case .human:
            return lines.map { "\($0.machine): \($0.problem.map { "problem: \($0)" } ?? done)" }.joined(separator: "\n")
        }
    }
}

/// `fardesk devices`: the devices registered on each machine.
public enum DevicesRenderer {
    public struct Machine: Sendable {
        public let name: String
        public let devices: [AuthDevice]

        public init(name: String, devices: [AuthDevice]) {
            self.name = name
            self.devices = devices
        }
    }

    private struct Row: Encodable {
        let machine: String
        let device: AuthDevice
    }

    public static func render(_ machines: [Machine], options: RenderOptions) throws -> String {
        switch options.format {
        case .json:
            return try JSONOutput.compact(machines.flatMap { machine in machine.devices.map { Row(machine: machine.name, device: $0) } })
        case .human:
            return machines.map { block($0, options: options) }.joined(separator: "\n\n")
        }
    }

    private static func block(_ machine: Machine, options: RenderOptions) -> String {
        guard !machine.devices.isEmpty else { return "\(machine.name)\n  (no devices)" }
        let rows = machine.devices.map { device in
            [
                device.name + (device.current ? " (this device)" : ""),
                device.id,
                device.revoked ? "revoked" : "active",
                device.lastSeenAt.map { RelativeTimeFormat.short(from: $0, to: options.now) } ?? "never",
                device.lastIp ?? "-",
            ]
        }
        let table = TextTable.render(header: ["DEVICE", "ID", "STATE", "LAST SEEN", "IP"], rows: rows)
        return ([machine.name] + table.map { "  " + $0 }).joined(separator: "\n")
    }
}

/// `fardesk revoke`: how many devices each machine revoked.
public enum RevokeRenderer {
    public struct Line: Sendable, Equatable {
        public let machine: String
        public let revoked: Int

        public init(machine: String, revoked: Int) {
            self.machine = machine
            self.revoked = revoked
        }
    }

    private struct Row: Encodable {
        let machine: String
        let revoked: Int
    }

    public static func render(_ lines: [Line], options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(lines.map { Row(machine: $0.machine, revoked: $0.revoked) })
        case .human: lines.map { "\($0.machine): revoked \($0.revoked) \($0.revoked == 1 ? "device" : "devices")" }.joined(separator: "\n")
        }
    }
}
