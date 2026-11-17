import SwiftUI
import WidgetKit

@main
struct FardeskWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WaitingWidget()
        PinnedSessionLiveActivity()
    }
}
