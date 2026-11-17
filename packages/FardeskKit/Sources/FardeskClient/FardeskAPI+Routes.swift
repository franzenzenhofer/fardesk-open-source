import FardeskModels
import Foundation

/// One method per route of the daemon's HTTP API (docs/DAEMON.md).
extension FardeskAPI {
    // MARK: Reading

    public func machine() async throws -> Machine {
        try await send(APIRequest(method: .get, segments: ["v1", "machine"]))
    }

    public func sessions() async throws -> [SessionSummary] {
        try await send(APIRequest(method: .get, segments: ["v1", "sessions"]))
    }

    public func activity(sessionID: String, before: String? = nil, limit: Int? = nil) async throws -> ActivityPage {
        let query = [("before", before), ("limit", limit.map(String.init))]
            .compactMap { name, value in value.map { URLQueryItem(name: name, value: $0) } }
        return try await send(APIRequest(method: .get, segments: ["v1", "sessions", sessionID, "activity"], query: query))
    }

    public func detail(sessionID: String, activityID: String) async throws -> ActivityDetail {
        try await send(
            APIRequest(method: .get, segments: ["v1", "sessions", sessionID, "activity", activityID, "detail"])
        )
    }

    /// The hub's view of every machine (`GET /v1/hub`); only a hub answers it.
    public func hub() async throws -> HubState {
        try await send(APIRequest(method: .get, segments: ["v1", "hub"]))
    }

    public func recentFolders() async throws -> RecentFolders {
        try await send(APIRequest(method: .get, segments: ["v1", "folders", "recent"]))
    }

    // MARK: Session actions

    @discardableResult
    public func message(sessionID: String, text: String, attachments: [String]? = nil) async throws -> MessageResult {
        try await post(["v1", "sessions", sessionID, "message"], MessageRequest(text: text, attachments: attachments))
    }

    public func stop(sessionID: String) async throws {
        let _: OkResult = try await post(["v1", "sessions", sessionID, "stop"])
    }

    /// Ends the session's process; with `closeTab` also its terminal pane or tab.
    @discardableResult
    public func kill(sessionID: String, closeTab: Bool = false) async throws -> KillResult {
        try await post(["v1", "sessions", sessionID, "kill"], KillRequest(closeTab: closeTab))
    }

    /// Stores raw bytes under the session's attachments folder on the machine; send the id with the message.
    public func uploadAttachment(
        sessionID: String,
        data: Data,
        mediaType: String,
        filename: String?
    ) async throws -> AttachmentResult {
        let headers = filename.map { ["X-Fardesk-Filename": Self.headerSafe($0)] } ?? [:]
        let request = APIRequest(
            method: .post, segments: ["v1", "sessions", sessionID, "attachments"],
            body: data, contentType: mediaType, headers: headers, timeout: Self.slowTimeout
        )
        return try await send(request)
    }

    /// The bytes of a stored attachment, found by the exact path the daemon wrote into the message.
    public func attachment(sessionID: String, path: String) async throws -> Data {
        try await sendRaw(
            APIRequest(
                method: .get, segments: ["v1", "sessions", sessionID, "attachment"],
                query: [URLQueryItem(name: "path", value: path)], timeout: Self.slowTimeout
            )
        )
    }

    public func resume(sessionID: String) async throws -> ActionResult {
        try await post(["v1", "sessions", sessionID, "resume"], timeout: Self.slowTimeout)
    }

    public func takeover(sessionID: String) async throws -> ActionResult {
        try await post(["v1", "sessions", sessionID, "takeover"], timeout: Self.slowTimeout)
    }

    public func fork(sessionID: String) async throws -> ActionResult {
        try await post(["v1", "sessions", sessionID, "fork"], timeout: Self.slowTimeout)
    }

    /// Starts a fresh conversation in the session (`/clear`); the result is the new session id.
    public func clear(sessionID: String) async throws -> ActionResult {
        try await post(["v1", "sessions", sessionID, "clear"], timeout: Self.slowTimeout)
    }

    /// Asks Claude to write a summary and continue from it (`/compact`); the result is the session to continue in.
    public func compact(sessionID: String) async throws -> ActionResult {
        try await post(["v1", "sessions", sessionID, "compact"], timeout: Self.slowTimeout)
    }

    public func mute(sessionID: String, muted: Bool) async throws {
        let _: OkResult = try await post(["v1", "sessions", sessionID, "mute"], MuteRequest(muted: muted))
    }

    public func decide(sessionID: String, requestID: String, decision: PermissionDecision) async throws {
        let body = PermissionDecisionRequest(decision: decision)
        let _: OkResult = try await post(["v1", "sessions", sessionID, "permission", requestID], body)
    }

    public func answer(sessionID: String, requestID: String, option: String) async throws {
        let _: OkResult = try await post(["v1", "sessions", sessionID, "answer", requestID], AnswerRequest(option: option))
    }

    public func newSession(_ request: NewSessionRequest) async throws -> ActionResult {
        try await post(["v1", "sessions", "new"], request, timeout: Self.slowTimeout)
    }

    // MARK: Telemetry and Ghostty

    /// Sends error reports; the machine drops the ones it already has (by id).
    public func reportTelemetry(_ reports: [TelemetryReport]) async throws -> TelemetryResult {
        try await post(["v1", "telemetry"], TelemetryBatch(reports: reports))
    }

    /// The reports a machine holds, newest first.
    public func telemetry(since: Date? = nil, limit: Int? = nil, kind: TelemetryKind? = nil) async throws -> TelemetryList {
        let sinceText = since.map { $0.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)) }
        let query = [("since", sinceText), ("limit", limit.map(String.init)), ("kind", kind?.rawValue)]
            .compactMap { name, value in value.map { URLQueryItem(name: name, value: $0) } }
        return try await send(APIRequest(method: .get, segments: ["v1", "telemetry"], query: query))
    }

    /// Whether this machine's pushes are paused, and until when.
    public func notifications() async throws -> NotificationState {
        try await send(APIRequest(method: .get, segments: ["v1", "notifications"]))
    }

    /// Pauses every push of this machine for `minutes`; 0 resumes at once.
    public func pauseNotifications(minutes: Int) async throws -> NotificationState {
        try await post(["v1", "notifications", "pause"], NotificationPauseRequest(minutes: minutes))
    }

    /// Asks macOS (once) whether the daemon may drive Ghostty and answers what it found.
    public func probeGhostty() async throws -> GhosttyProbeResult {
        try await post(["v1", "machine", "ghostty", "probe"])
    }

    // MARK: Coordinator

    public func coordinatorState() async throws -> CoordinatorState {
        try await send(APIRequest(method: .get, segments: ["v1", "coordinator"]))
    }

    /// Sends a prompt to the coordinator session, starting it when none runs. The result holds its id.
    public func askCoordinator(prompt: String) async throws -> ActionResult {
        try await post(["v1", "coordinator"], CoordinatorRequest(prompt: prompt))
    }

    public func registerDevice(_ request: DeviceRequest) async throws {
        let _: OkResult = try await post(["v1", "devices"], request)
    }

    // MARK: Auth

    public func login(password: String, deviceName: String) async throws -> LoginResult {
        try await post(["v1", "auth", "login"], LoginRequest(password: password, deviceName: deviceName))
    }

    /// Exchanges the one-time code of a pairing link for a device token (no bearer needed).
    public func pair(code: String, deviceName: String) async throws -> LoginResult {
        try await post(["v1", "auth", "pair"], PairRequest(code: code, deviceName: deviceName))
    }

    public func logout(apnsToken: String?) async throws {
        let _: OkResult = try await post(["v1", "auth", "logout"], LogoutRequest(apnsToken: apnsToken))
    }

    public func authDevices() async throws -> AuthDeviceList {
        try await send(APIRequest(method: .get, segments: ["v1", "auth", "devices"]))
    }

    public func revoke(device: String?) async throws -> RevokeResult {
        try await post(["v1", "auth", "revoke"], RevokeRequest(device: device))
    }

    public func changePassword(current: String, next: String) async throws {
        let body = PasswordChangeRequest(current: current, next: next)
        let _: OkResult = try await post(["v1", "auth", "password"], body)
    }

    // MARK: Core

    /// Header values must be one line of plain ASCII.
    private static func headerSafe(_ name: String) -> String {
        let ascii = name.unicodeScalars.map { $0.isASCII && $0.value >= 32 ? Character($0) : "_" }
        return String(ascii)
    }

    private func post<Response: Decodable>(_ segments: [String], timeout: TimeInterval? = nil) async throws -> Response {
        try await send(APIRequest(method: .post, segments: segments, timeout: timeout))
    }

    private func post<Response: Decodable, Body: Encodable>(
        _ segments: [String],
        _ body: Body,
        timeout: TimeInterval? = nil
    ) async throws -> Response {
        try await send(APIRequest(method: .post, segments: segments, body: json(body), timeout: timeout))
    }
}
