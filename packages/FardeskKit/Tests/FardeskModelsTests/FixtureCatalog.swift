import FardeskModels
import Foundation
import Testing

/// One golden fixture file written by the daemon's contract generator.
struct Fixture: Sendable, CustomTestStringConvertible {
    let contractName: String
    let caseName: String
    let url: URL

    var testDescription: String { "\(contractName)/\(caseName)" }
}

enum FixtureCatalog {
    typealias Codec = @Sendable (Data) throws -> Data

    /// Repo root, found from this file: packages/FardeskKit/Tests/FardeskModelsTests/<file>.
    static let fixturesDirectory: URL = {
        var url = URL(filePath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url.appending(path: "daemon/fardeskd/schema/fixtures", directoryHint: .isDirectory)
    }()

    /// Contract name to a decode-then-encode round trip through the Swift type.
    static let registry: [String: Codec] = [
        "Machine": roundTrip(Machine.self),
        "SessionSummary": roundTrip(SessionSummary.self),
        "Activity": roundTrip(Activity.self),
        "ActivityPage": roundTrip(ActivityPage.self),
        "ActivityDetail": roundTrip(ActivityDetail.self),
        "RecentFolders": roundTrip(RecentFolders.self),
        "MessageRequest": roundTrip(MessageRequest.self),
        "PermissionRequest": roundTrip(PermissionDecisionRequest.self),
        "AnswerRequest": roundTrip(AnswerRequest.self),
        "MuteRequest": roundTrip(MuteRequest.self),
        "LabelRequest": roundTrip(LabelRequest.self),
        "CoordinatorRequest": roundTrip(CoordinatorRequest.self),
        "FolderSearch": roundTrip(FolderSearch.self),
        "CoordinatorState": roundTrip(CoordinatorState.self),
        "NewSessionRequest": roundTrip(NewSessionRequest.self),
        "DeviceRequest": roundTrip(DeviceRequest.self),
        "ActionResult": roundTrip(ActionResult.self),
        "OkResult": roundTrip(OkResult.self),
        "MessageResult": roundTrip(MessageResult.self),
        "ErrorResponse": roundTrip(ErrorResponse.self),
        "StreamEvent": roundTrip(StreamEvent.self),
        "PairingPayload": roundTrip(PairingPayload.self),
        "PairRequest": roundTrip(PairRequest.self),
        "PairCodeResult": roundTrip(PairCodeResult.self),
        "LoginRequest": roundTrip(LoginRequest.self),
        "LoginResult": roundTrip(LoginResult.self),
        "LogoutRequest": roundTrip(LogoutRequest.self),
        "AuthDeviceList": roundTrip(AuthDeviceList.self),
        "RevokeRequest": roundTrip(RevokeRequest.self),
        "RevokeResult": roundTrip(RevokeResult.self),
        "PasswordChangeRequest": roundTrip(PasswordChangeRequest.self),
        "TelemetryReport": roundTrip(TelemetryReport.self),
        "TelemetryBatch": roundTrip(TelemetryBatch.self),
        "TelemetryResult": roundTrip(TelemetryResult.self),
        "TelemetryList": roundTrip(TelemetryList.self),
        "GhosttyProbeResult": roundTrip(GhosttyProbeResult.self),
        "AttachmentResult": roundTrip(AttachmentResult.self),
        "KillRequest": roundTrip(KillRequest.self),
        "KillResult": roundTrip(KillResult.self),
        "HubMachine": roundTrip(HubMachine.self),
        "HubState": roundTrip(HubState.self),
        "NotificationPauseRequest": roundTrip(NotificationPauseRequest.self),
        "NotificationState": roundTrip(NotificationState.self),
    ]

    static func contractDirectories() throws -> [URL] {
        try FileManager.default
            .contentsOfDirectory(at: fixturesDirectory, includingPropertiesForKeys: nil)
            .filter { $0.hasDirectoryPath }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    static func allFixtures() throws -> [Fixture] {
        try contractDirectories().flatMap { directory in
            try FileManager.default
                .contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "json" }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
                .map {
                    Fixture(
                        contractName: directory.lastPathComponent,
                        caseName: $0.deletingPathExtension().lastPathComponent,
                        url: $0
                    )
                }
        }
    }

    private static func roundTrip<T: Codable & SendableMetatype>(_: T.Type) -> Codec {
        { data in
            let value = try FardeskJSON.makeDecoder().decode(T.self, from: data)
            return try FardeskJSON.makeEncoder().encode(value)
        }
    }
}

/// Canonical JSON text: parsed, then re-serialised with sorted keys, so two documents
/// are equal exactly when numbers, booleans, strings, nulls, arrays and objects match.
func canonicalJSON(_ data: Data) throws -> String {
    let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    let canonical = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed])
    return String(decoding: canonical, as: UTF8.self)
}
