import FardeskStore
import Foundation
#if os(iOS)
import ActivityKit
import Observation
import OSLog

/// Owns the one pinned Live Activity: starts it from the session menu, keeps it current from the
/// app state while the app runs, and ends it when the session goes idle or ended (local updates only).
@MainActor
@Observable
final class LiveActivityController: LiveActivityApplying {
    private(set) var pinned: SessionRef?
    private(set) var failure: String?
    /// Told whenever the pinned session changes (the extension writer follows it).
    @ObservationIgnored var onPinnedChange: (@Sendable (SessionRef?) -> Void)?
    @ObservationIgnored private var activity: Activity<FardeskActivityAttributes>?
    @ObservationIgnored private var lastSent: LiveActivityContent?
    @ObservationIgnored private var queue: Task<Void, Never>?
    @ObservationIgnored private let log = Logger(subsystem: AppIdentity.bundleID, category: "liveactivity")

    init() {
        activity = Activity<FardeskActivityAttributes>.activities.first
        pinned = activity?.attributes.ref
    }

    private func setPinned(_ ref: SessionRef?) {
        pinned = ref
        onPinnedChange?(ref)
    }

    func isPinned(_ ref: SessionRef) -> Bool { pinned == ref }

    func pin(_ ref: SessionRef, state: AppState, feed: SessionFeed) {
        guard let content = LiveActivityContent.make(state: state, ref: ref, feed: feed) else {
            fail("Only a working or waiting session can be pinned.")
            return
        }
        failure = nil
        setPinned(ref)
        enqueue { [self] in
            await endCurrent()
            start(ref, content: content)
        }
    }

    func unpin() {
        setPinned(nil)
        enqueue { [self] in await endCurrent() }
    }

    /// Content computed off the main thread by the extension writer: updates the pinned activity, or ends it
    /// when the session is no longer live (nil).
    func apply(_ content: LiveActivityContent?) async {
        guard pinned != nil else { return }
        guard let content else { return unpin() }
        guard content != lastSent else { return }
        enqueue { [self] in await send(content) }
    }

    private func enqueue(_ work: @escaping @MainActor () async -> Void) {
        let previous = queue
        queue = Task { @MainActor in
            await previous?.value
            await work()
        }
    }

    private func start(_ ref: SessionRef, content: LiveActivityContent) {
        let attributes = FardeskActivityAttributes(machineID: ref.machineID, sessionID: ref.sessionID)
        do {
            activity = try Activity.request(
                attributes: attributes, content: .init(state: content, staleDate: nil), pushType: nil
            )
            lastSent = content
        } catch {
            setPinned(nil)
            fail("Could not start the Live Activity: \(error.localizedDescription)")
        }
    }

    private func send(_ content: LiveActivityContent) async {
        for running in Activity<FardeskActivityAttributes>.activities {
            await running.update(.init(state: content, staleDate: nil))
        }
        lastSent = content
    }

    private func endCurrent() async {
        for running in Activity<FardeskActivityAttributes>.activities {
            await running.end(nil, dismissalPolicy: .immediate)
        }
        activity = nil
        lastSent = nil
    }

    private func fail(_ message: String) {
        failure = message
        log.error("\(message, privacy: .public)")
    }
}
#endif
