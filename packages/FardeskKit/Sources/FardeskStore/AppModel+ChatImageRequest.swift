import FardeskModels
import Foundation

/// "Ask the coordinator for a suitable image" (the Image section of a chat's info sheet): the coordinator on the hub
/// makes a fitting square picture for the chat and sets it with its set_session_image tool, on any machine.
public enum ChatImageRequest {
    public static func prompt(for session: SessionSummary, machineName: String) -> String {
        let about = session.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        return """
        Give the chat "\(session.displayTitle)" (session id \(session.id) on the machine "\(machineName)", folder \
        \(session.cwd)) a suitable image for the list on the phone. What it is about, as far as the app sees it: \
        \(about.isEmpty ? "only its title" : about).
        Make one simple, clear, square picture that fits its topic and reads at 55 points: one subject, flat, strong \
        contrast, no text, no logos or trademarks of others. Draw it yourself (for example an SVG converted to PNG with \
        a tool on this machine) at 512 x 512, under 2 MB. Then call set_session_image with machine "\(machineName)", \
        that session id and the file. Do not change anything else.
        Reply in one short line: what the picture shows.
        """
    }
}

extension AppModel {
    /// The hub, when it answers and runs the coordinator; nil otherwise.
    public var coordinatorForImages: UUID? {
        guard let hub = hubMachineID, coordinatorEnabled, (try? state.machine(id: hub))?.isOnline == true else { return nil }
        return hub
    }

    /// Hands the job to the coordinator; true when the coordinator took it (the image arrives with the next refresh).
    /// From the tap until the image arrives the chat counts as pending, so a second tap sends nothing.
    public func askCoordinatorForImage(_ ref: SessionRef, now: Date = Date()) async -> Bool {
        guard let hub = coordinatorForImages, let machine = try? state.machine(id: ref.machineID),
              let session = machine.sessions.first(where: { $0.id == ref.sessionID }) else { return false }
        let image = session.label.image
        if pendingImageRequests.isPending(ref, currentImage: image, at: now) { return true }
        pendingImageRequests.asked(ref, currentImage: image, at: now)
        let taken = await askCoordinator(ChatImageRequest.prompt(for: session, machineName: machine.endpoint.name), on: hub) != nil
        if !taken { pendingImageRequests.forget(ref) }
        return taken
    }

    /// True while the coordinator is still making this chat's image.
    public func isMakingImage(_ ref: SessionRef, currentImage: String?, now: Date = Date()) -> Bool {
        pendingImageRequests.isPending(ref, currentImage: currentImage, at: now)
    }
}
