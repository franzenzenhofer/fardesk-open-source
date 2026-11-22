import Foundation

public enum TelemetryKind: String, TolerantEnum {
    case error, event, unknown
}

/// One error an app or CLI reports back so it can be fixed without anyone describing it.
public struct TelemetryReport: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let at: Date
    public let message: String
    public let area: String
    public let appVersion: String
    public let build: String
    public let platform: String
    public let code: String?
    public let machine: String?
    public let sessionId: String?
    /// Absent = an error (older apps); `event` = something that happened, with its timing.
    public let kind: TelemetryKind?
    public let durationMs: Int?

    public init(
        id: String = UUID().uuidString.lowercased(),
        at: Date,
        message: String,
        area: String,
        appVersion: String,
        build: String,
        platform: String,
        code: String? = nil,
        machine: String? = nil,
        sessionId: String? = nil,
        kind: TelemetryKind? = nil,
        durationMs: Int? = nil
    ) {
        self.id = id
        self.at = at
        self.message = message
        self.area = area
        self.appVersion = appVersion
        self.build = build
        self.platform = platform
        self.code = code
        self.machine = machine
        self.sessionId = sessionId
        self.kind = kind
        self.durationMs = durationMs
    }
}

/// Body of `POST /v1/telemetry`: 1 to 200 reports.
public struct TelemetryBatch: Codable, Sendable, Hashable {
    public static let maxReports = 200

    public let reports: [TelemetryReport]

    public init(reports: [TelemetryReport]) {
        self.reports = reports
    }
}

public struct TelemetryResult: Codable, Sendable, Hashable {
    public let accepted: Int
    public let duplicates: Int
}

/// Answer of `GET /v1/telemetry`: newest first.
public struct TelemetryList: Codable, Sendable, Hashable {
    public let reports: [TelemetryReport]
}

/// Whether the daemon may drive Ghostty through macOS Automation.
public enum GhosttyAutomation: String, TolerantEnum {
    case ok, denied, unknown
}

public struct GhosttyProbeResult: Codable, Sendable, Hashable {
    public let ghosttyAutomation: GhosttyAutomation
}

/// Answer of `POST /v1/sessions/:id/attachments`.
public struct AttachmentResult: Codable, Sendable, Hashable {
    public let attachmentId: String
    public let path: String
    public let mediaType: String
    public let bytes: Int
}

/// Body of `POST /v1/sessions/:id/kill`; the body may also be left out (same as `closeTab: false`).
public struct KillRequest: Codable, Sendable, Hashable {
    public let closeTab: Bool

    public init(closeTab: Bool) {
        self.closeTab = closeTab
    }
}

/// What a kill closed on the machine.
public enum ClosedSurface: String, TolerantEnum {
    case pane, tab, none, unknown
}

public struct KillResult: Codable, Sendable, Hashable {
    public let closed: ClosedSurface

    private enum CodingKeys: String, CodingKey {
        case ok, closed
    }

    public init(closed: ClosedSurface) {
        self.closed = closed
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Bool.self, forKey: .ok) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "KillResult.ok must be true")
            )
        }
        closed = try c.decode(ClosedSurface.self, forKey: .closed)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(true, forKey: .ok)
        try c.encode(closed, forKey: .closed)
    }
}

/// The media types the daemon accepts as attachments, from the file extension.
public enum AttachmentMediaType {
    private static let byExtension: [String: String] = [
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "heic": "image/heic",
        "m4a": "audio/m4a", "mp4": "audio/mp4", "wav": "audio/wav",
    ]

    public static func forExtension(_ pathExtension: String) -> String? {
        byExtension[pathExtension.lowercased()]
    }

    public static var supportedExtensions: [String] { byExtension.keys.sorted() }
}
