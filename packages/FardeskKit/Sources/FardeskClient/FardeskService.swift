import FardeskModels
import Foundation

/// Everything the app asks of one machine once it is signed in: reading sessions and acting on them. The HTTP client
/// (`FardeskAPI`) is the real implementation; the demo world in `FardeskDemo` is the second one, so the app can show
/// every screen without a computer. Login, pairing, devices, telemetry, the hub and the live stream are not here:
/// they only exist for a real machine.
public protocol FardeskService: Sendable {
    func machine() async throws -> Machine
    func sessions() async throws -> [SessionSummary]
    func activity(sessionID: String, before: String?, limit: Int?) async throws -> ActivityPage
    func detail(sessionID: String, activityID: String) async throws -> ActivityDetail
    func recentFolders() async throws -> RecentFolders

    @discardableResult
    func message(sessionID: String, text: String, attachments: [String]?) async throws -> MessageResult
    func stop(sessionID: String) async throws
    @discardableResult
    func kill(sessionID: String, closeTab: Bool) async throws -> KillResult
    func uploadAttachment(sessionID: String, data: Data, mediaType: String, filename: String?) async throws -> AttachmentResult
    func attachment(sessionID: String, path: String) async throws -> Data
    func resume(sessionID: String) async throws -> ActionResult
    func takeover(sessionID: String) async throws -> ActionResult
    func fork(sessionID: String) async throws -> ActionResult
    func clear(sessionID: String) async throws -> ActionResult
    func compact(sessionID: String) async throws -> ActionResult
    func mute(sessionID: String, muted: Bool) async throws
    func label(sessionID: String, _ request: LabelRequest) async throws
    func setImage(sessionID: String, data: Data, mediaType: String) async throws -> ImageResult
    func clearImage(sessionID: String) async throws
    func image(sessionID: String) async throws -> Data
    /// Removes a stopped chat from the list, or brings it back; the list of removed ones is for Settings.
    func hide(sessionID: String) async throws
    func unhide(sessionID: String) async throws
    func hiddenSessions() async throws -> [HiddenSession]
    /// `message` is the feedback of a plan answered with `revise`; nil for every other decision.
    func decide(sessionID: String, requestID: String, decision: PermissionDecision, message: String?) async throws
    func answer(sessionID: String, requestID: String, option: String) async throws
    func answerDialog(sessionID: String, requestID: String, answer: String) async throws
    func newSession(_ request: NewSessionRequest) async throws -> ActionResult
    func notifications() async throws -> NotificationState
    func pauseNotifications(minutes: Int) async throws -> NotificationState
    func coordinatorState() async throws -> CoordinatorState
    func askCoordinator(prompt: String) async throws -> ActionResult
}

extension FardeskAPI: FardeskService {}

extension FardeskService {
    public func decide(sessionID: String, requestID: String, decision: PermissionDecision) async throws {
        try await decide(sessionID: sessionID, requestID: requestID, decision: decision, message: nil)
    }
}
