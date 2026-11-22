import FardeskModels
import FardeskStore
import SwiftUI

/// The one stream of a session: the conversation, the queued messages, what blocks Claude (permission,
/// question, dialog) and the latest notice, all in order at the bottom. It follows new content while the
/// user is at the bottom and never moves when the user scrolled up (then "New activity" shows).
struct FeedView: View {
    private static let bottomID = "feed-bottom"
    /// Only this close to the end counts as "at the bottom": reading a little higher up must never be pulled down.
    private static let nearBottomDistance = 24.0
    /// When the landing passes run after a session opens (see `land`).
    private static let landingDelays: [Duration] = [.milliseconds(60), .milliseconds(120), .milliseconds(250)]

    private struct Position: Equatable {
        var isNearBottom = true
        var fitsViewport = true
        var contentHeight = 0.0
    }

    @Environment(AppModel.self) private var model
    @Environment(VoiceReader.self) private var voice
    let ref: SessionRef
    /// This session's own feed: reading it here (and nowhere above) keeps every other screen out of a stream of rows.
    let box: FeedBox
    @State private var position = Position()
    @State private var hasNewActivity = false
    /// Whether the feed was put at its newest row once: rows that arrive after the screen opened must land there too.
    @State private var hasLanded = false
    @State private var loadingEarlier = false
    /// What the last "Load earlier messages" brought, faded in and marked (nil before the first tap).
    @State private var earlier: EarlierRows?

    private var pending: [PendingMessage] { model.outbox.pending(for: ref) }

    /// Nothing known yet and nothing started to say why: the first frame of a session never seen before.
    private func showsSkeleton(_ feed: SessionFeed, pending: [PendingMessage]) -> Bool {
        guard feed.activities.isEmpty, pending.isEmpty else { return false }
        return model.stepLogs[ref].map(\.isRunning) ?? true
    }

    var body: some View {
        let _ = Breadcrumbs.mark("view FeedView")
        let feed = box.feed
        let pending = pending
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if feed.canLoadMore {
                        LoadEarlierButton(isLoading: loadingEarlier) { loadEarlier(feed, proxy) }
                    }
                    if showsSkeleton(feed, pending: pending) { SkeletonRows() }
                    ForEach(feed.blocks) { block in
                        if block.id == earlier?.boundaryID, let earlier { EarlierRowsMark(label: earlier.label) }
                        FeedRow(block: block, gotIt: model.outbox.isDelivered(rowID: block.id)).equatable()
                            .modifier(FadesInWhenNew(isNew: earlier?.ids.contains(block.id) == true))
                            .id(block.id)
                    }
                    ForEach(pending) { PendingMessageRow(message: $0).id($0.id) }
                    FeedStepLog(ref: ref, box: box)
                    PendingRequestCards(ref: ref, box: box)
                    AttentionCardView(ref: ref, box: box)
                    NoticeRow(scope: .session(ref))
                    Color.clear.frame(height: 1).id(Self.bottomID)
                }
                .padding()
            }
            .simultaneousGesture(TapGesture().onEnded { voice.stop(); Keyboard.dismiss() })
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .onScrollGeometryChange(for: Position.self) { geometry in
                Position(
                    isNearBottom: geometry.visibleRect.maxY >= geometry.contentSize.height - Self.nearBottomDistance,
                    fitsViewport: geometry.contentSize.height <= geometry.containerSize.height,
                    contentHeight: geometry.contentSize.height
                )
            } action: { old, new in
                position = new
                if new.isNearBottom || new.fitsViewport { hasNewActivity = false }
                if new.contentHeight > old.contentHeight, old.isNearBottom { jumpToBottom(proxy) }
            }
            .onChange(of: model.sendSignal) { scrollToBottom(proxy) }
            .onChange(of: feed.blocks.last?.id) { hasLanded ? rowsChanged() : land(proxy) }
            // Every other session (a new ref) opens at its newest row, also when this view was reused for it
            // (the split view detail, the Coordinator) and also for a chat opened and scrolled up before.
            .task(id: ref) {
                hasLanded = false
                earlier = nil
                hasNewActivity = false
                if !box.feed.blocks.isEmpty { land(proxy) }
            }
            .overlay(alignment: .bottom) {
                if FeedPinning.pillVisible(
                    hasNewActivity: hasNewActivity, isNearBottom: position.isNearBottom, contentFitsViewport: position.fitsViewport
                ) {
                    Button("New activity", systemImage: "arrow.down") { scrollToBottom(proxy) }
                        .buttonStyle(.fardeskPrimary)
                        .padding()
                }
            }
        }
    }

    /// Growth while at the bottom follows by itself (geometry change); a new row while scrolled up only lights the pill.
    private func rowsChanged() {
        if FeedPinning.onNewRows(userJustSent: false, isNearBottom: position.isNearBottom, contentFitsViewport: position.fitsViewport)
            == .showNewActivityPill {
            hasNewActivity = true
        }
    }

    /// Opens at the newest row, also when the rows arrive after the screen appeared (the initial anchor only covers
    /// rows that are there at the first layout). One layout pass later, so the rows have a size.
    /// Several passes: a LazyVStack only estimates the height of rows it has not laid out, so the first jump can
    /// stop short of the real end; each pass after the rows got their size corrects it, without animation.
    private func land(_ proxy: ScrollViewProxy) {
        hasLanded = true
        Task { @MainActor in
            for delay in Self.landingDelays {
                try? await Task.sleep(for: delay)
                jumpToBottom(proxy)
            }
        }
    }

    /// Older rows go above; the row the user was reading stays where it was.
    private func loadEarlier(_ feed: SessionFeed, _ proxy: ScrollViewProxy) {
        let anchor = feed.blocks.first?.id
        loadingEarlier = true
        Task {
            await model.loadOlder(ref)
            earlier = EarlierRows(blockIDs: box.feed.blocks.map(\.id), previousFirstID: anchor)
            loadingEarlier = false
            // The old first row moves down a little, so the rows that came in (fading in) are on screen above it.
            if let anchor { proxy.scrollTo(anchor, anchor: UnitPoint(x: 0.5, y: 0.4)) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation { jumpToBottom(proxy) }
    }

    /// Without animation: content that grows while the user reads at the bottom must not wobble.
    private func jumpToBottom(_ proxy: ScrollViewProxy) {
        proxy.scrollTo(Self.bottomID, anchor: .bottom)
        hasNewActivity = false
    }
}
