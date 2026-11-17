import FardeskStore
import SwiftUI

/// The permissions and questions Claude waits on, as the last rows of the feed. Reads the feed itself, so only
/// this view (not the whole session screen) redraws when a row arrives.
struct PendingRequestCards: View {
    let ref: SessionRef
    let box: FeedBox

    var body: some View {
        ForEach(box.feed.pendingRequests) { RequestCard(activity: $0, ref: ref) }
    }
}

/// The step log as a row of the feed ("Loading the last 50 rows...") while something runs, failed, or the feed
/// has no rows to show yet.
struct FeedStepLog: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef
    let box: FeedBox

    var body: some View {
        if let log = model.stepLogs[ref], log.isVisible(feedHasRows: !box.feed.rows.isEmpty) {
            StepLogView(log: log)
        }
    }
}
