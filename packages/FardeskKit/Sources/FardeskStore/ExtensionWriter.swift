import Foundation

/// Writes what the widget and the Live Activity show, off the main thread. States arrive often; only the
/// newest one is written, after a quiet second, and only when the widget would draw something different.
public actor ExtensionWriter {
    public static let debounce: Duration = .seconds(1)

    private let store: WaitingSnapshotStore?
    private let delay: Duration
    private let onWritten: @Sendable () -> Void
    private let onLiveActivity: @Sendable (LiveActivityContent?) async -> Void
    private var current: AppState?
    private var stateIsNew = false
    private var liveIsStale = false
    private var lastWritten: WaitingSnapshot?
    private var toolTitles: [SessionRef: String?] = [:]
    private var pinned: SessionRef?
    private var pending: Task<Void, Never>?
    public private(set) var writes = 0

    /// `store` nil = no App Group container (not on iOS). `onWritten` reloads the widget timelines.
    public init(
        store: WaitingSnapshotStore?,
        delay: Duration = ExtensionWriter.debounce,
        onWritten: @escaping @Sendable () -> Void = {},
        onLiveActivity: @escaping @Sendable (LiveActivityContent?) async -> Void = { _ in }
    ) {
        self.store = store
        self.delay = delay
        self.onWritten = onWritten
        self.onLiveActivity = onLiveActivity
    }

    /// Which session the Live Activity follows (nil = none).
    public func setPinned(_ ref: SessionRef?) {
        pinned = ref
    }

    /// Hands over the newest state; the write happens later, on this actor.
    public func submit(_ state: AppState) {
        current = state
        stateIsNew = true
        liveIsStale = true
        schedule()
    }

    /// Hands over a changed feed; only its newest tool title matters (the Live Activity line), and only when it differs.
    public func submit(feed: SessionFeed, of ref: SessionRef) {
        let title = LiveActivityContent.lastToolTitle(in: feed)
        guard toolTitles[ref] != .some(title) else { return }
        toolTitles[ref] = .some(title)
        guard ref == pinned else { return }
        liveIsStale = true
        schedule()
    }

    private func schedule() {
        guard pending == nil else { return }
        pending = Task { [delay] in
            try? await Task.sleep(for: delay)
            await self.flush()
        }
    }

    /// Writes the newest state now.
    public func flush() async {
        pending = nil
        guard let state = current else { return }
        if stateIsNew { writeWidget(for: state) }
        stateIsNew = false
        guard liveIsStale, let pinned else { return }
        liveIsStale = false
        await onLiveActivity(LiveActivityContent.make(state: state, ref: pinned, lastToolTitle: toolTitles[pinned] ?? nil))
    }

    /// The last written snapshot is remembered here, so an unchanged widget costs no file read.
    private func writeWidget(for state: AppState) {
        guard let store else { return }
        let snapshot = WaitingSnapshot(state: state, now: Date())
        if let lastWritten, lastWritten.hasSameContent(as: snapshot) { return }
        guard let changedFile = try? store.save(snapshot) else { return }
        lastWritten = snapshot
        if changedFile {
            writes += 1
            onWritten()
        }
    }
}
