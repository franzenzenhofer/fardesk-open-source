import FardeskClient
import FardeskModels
import Foundation

/// The demo's answer to `FardeskService` for one pretend machine: what the HTTP client would fetch and do on a real one,
/// served from memory.
struct DemoMachineService: FardeskService {
    static let pageLimit = 50

    let world: DemoWorld
    let machineKey: String

    // MARK: Reading

    func machine() async throws -> Machine { try world.machineInfo(machineKey) }

    func sessions() async throws -> [SessionSummary] { world.sessions(of: machineKey) }

    func activity(sessionID: String, before: String?, limit: Int?) async throws -> ActivityPage {
        let all = try world.record(sessionID, on: machineKey).activities
        var end = all.count
        if let before {
            guard let index = all.firstIndex(where: { $0.id == before }) else { throw DemoWorld.notFound("activity \(before)") }
            end = index
        }
        let start = max(0, end - (limit ?? Self.pageLimit))
        let items = Array(all[start..<end])
        let next = start > 0 ? items.first?.id : nil
        return try DemoJSON.decode(from: ["items": try items.map(DemoJSON.dictionary), "nextBefore": DemoJSON.orNull(next)])
    }

    func detail(sessionID: String, activityID: String) async throws -> ActivityDetail {
        guard let detail = try world.record(sessionID, on: machineKey).details[activityID] else {
            throw DemoWorld.notFound("details of \(activityID)")
        }
        return detail
    }

    func recentFolders() async throws -> RecentFolders {
        try DemoJSON.decode(from: ["folders": try world.folders(of: machineKey).map(DemoJSON.dictionary)])
    }

    func notifications() async throws -> NotificationState {
        NotificationState(pausedUntil: world.pausedUntil(now: world.clock()))
    }

    func pauseNotifications(minutes: Int) async throws -> NotificationState {
        NotificationState(pausedUntil: world.pause(minutes: minutes, now: world.clock()))
    }

    /// The coordinator needs a hub of several machines; the demo machines say so instead of pretending.
    func coordinatorState() async throws -> CoordinatorState { CoordinatorState(sessionId: nil) }

    func askCoordinator(prompt: String) async throws -> ActionResult {
        throw FardeskAPIError.server(
            status: 501,
            response: ErrorResponse(error: ErrorBody(code: .unsupported, message: "The coordinator is not part of the demo."))
        )
    }

    // MARK: Chat image

    func setImage(sessionID: String, data: Data, mediaType: String) async throws -> ImageResult {
        throw Self.imageUnsupported
    }

    func clearImage(sessionID: String) async throws { throw Self.imageUnsupported }

    func image(sessionID: String) async throws -> Data { throw DemoWorld.notFound("image of \(sessionID)") }

    private static var imageUnsupported: FardeskAPIError {
        .server(status: 501, response: ErrorResponse(error: ErrorBody(code: .unsupported, message: "Chat images are not part of the demo.")))
    }

    // MARK: Attachments

    func uploadAttachment(sessionID: String, data: Data, mediaType: String, filename: String?) async throws -> AttachmentResult {
        _ = try world.record(sessionID, on: machineKey)
        let name = filename ?? "attachment"
        return try DemoJSON.decode(from: [
            "attachmentId": world.newID("demo-attachment"), "path": "/demo/attachments/\(name)", "mediaType": mediaType, "bytes": data.count,
        ])
    }

    func attachment(sessionID: String, path: String) async throws -> Data {
        _ = try world.record(sessionID, on: machineKey)
        guard path.hasSuffix("/\(DemoFixture.imageName).png") else { throw DemoWorld.notFound("attachment \(path)") }
        return try DemoFixture.resource(DemoFixture.imageName, "png")
    }
}
