import Foundation

/// The chats whose image the coordinator is making right now. A request counts as pending until the chat's image
/// changes (the coordinator set it) or `patience` has passed (the job died quietly), so the button cannot be pressed
/// again and again while the picture is on its way, and comes back when it plainly is not.
public struct PendingImageRequests: Equatable, Sendable {
    public static let patience: TimeInterval = 10 * 60

    struct Request: Equatable, Sendable {
        let asked: Date
        /// The chat's image when the job was handed over (nil = none): a different one means the job is done.
        let imageAtAsk: String?
    }

    var requests: [SessionRef: Request] = [:]

    public init() {}

    public mutating func asked(_ ref: SessionRef, currentImage: String?, at now: Date) {
        requests[ref] = Request(asked: now, imageAtAsk: currentImage)
    }

    public mutating func forget(_ ref: SessionRef) {
        requests[ref] = nil
    }

    /// True while the coordinator is still making this chat's image.
    public func isPending(_ ref: SessionRef, currentImage: String?, at now: Date) -> Bool {
        guard let request = requests[ref] else { return false }
        return request.imageAtAsk == currentImage && now.timeIntervalSince(request.asked) < Self.patience
    }
}
