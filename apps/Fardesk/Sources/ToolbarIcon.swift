import SwiftUI

/// The label of an icon-only toolbar button. iOS 26 fires a toolbar button only for taps on its
/// label, not on the whole glass circle around it (https://developer.apple.com/forums/thread/815492),
/// so the label fills the circle.
struct ToolbarIcon: View {
    let systemName: String

    var body: some View {
        Image(systemName: systemName)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}
