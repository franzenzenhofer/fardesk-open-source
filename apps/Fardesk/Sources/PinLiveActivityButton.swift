import FardeskStore
import SwiftUI

/// "Pin Live Activity" in the session menu: iOS only, empty on the Mac.
struct PinLiveActivityButton: View {
    let ref: SessionRef

    var body: some View {
        #if os(iOS)
        PinToggle(ref: ref).disabledInDemo(.liveActivityPin)
        #else
        EmptyView()
        #endif
    }
}

#if os(iOS)
private struct PinToggle: View {
    @Environment(AppModel.self) private var model
    let ref: SessionRef

    var body: some View {
        let controller = AppServices.shared.liveActivity
        if controller.isPinned(ref) {
            Button("Unpin Live Activity", systemImage: "pin.slash") { controller.unpin() }
        } else {
            Button("Pin Live Activity", systemImage: "pin") { controller.pin(ref, state: model.state, feed: model.feeds.feed(for: ref)) }
        }
    }
}
#endif
