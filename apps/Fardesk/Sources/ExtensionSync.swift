import FardeskStore
import Foundation
#if os(iOS)
import OSLog
import WidgetKit
#endif

/// Keeps the Home Screen widget and the Live Activity current. Nothing here runs on the main actor per state change:
/// the model hands every new state to the `ExtensionWriter` actor, which writes the newest one after a quiet second.
@MainActor
enum ExtensionSync {
    /// The writer for this process: widget file + timeline reload, and the pinned Live Activity.
    static func makeWriter(liveActivity: LiveActivityApplying) -> ExtensionWriter {
        #if os(iOS)
        let log = Logger(subsystem: AppIdentity.bundleID, category: "widget")
        let store = WaitingSnapshotStore.appGroup
        if store == nil { log.error("App Group \(WaitingSnapshotStore.appGroupID, privacy: .public) is not available") }
        return ExtensionWriter(
            store: store,
            onWritten: { WidgetCenter.shared.reloadAllTimelines() },
            onLiveActivity: { content in await liveActivity.apply(content) }
        )
        #else
        ExtensionWriter(store: nil)
        #endif
    }

    /// Wires the model to the writer. DEBUG launch argument `-FardeskNoExtensionSync YES` leaves it unwired,
    /// to tell whether the widget and Live Activity work were what blocked the main thread.
    static func install(model: AppModel, writer: ExtensionWriter) {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "FardeskNoExtensionSync") { return }
        #endif
        model.onStateChange = { state in
            Task { await writer.submit(state) }
        }
        model.onFeedChange = { ref, feed in
            Task { await writer.submit(feed: feed, of: ref) }
        }
    }
}

/// What the Live Activity controller offers the writer (a type that is not iOS-only, so macOS compiles too).
protocol LiveActivityApplying: Sendable {
    func apply(_ content: LiveActivityContent?) async
}

/// macOS has no Live Activities.
struct NoLiveActivity: LiveActivityApplying {
    func apply(_ content: LiveActivityContent?) async {}
}
