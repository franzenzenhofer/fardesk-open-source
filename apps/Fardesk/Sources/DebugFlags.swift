import Observation
import SwiftUI

/// DEBUG-only launch arguments that each take ONE thing away from the logged-in Machines screen, to find which one
/// keeps the layout from settling. In a Release build every flag is false and the screen is the normal one.
enum DebugFlags {
    static let noBottomBar = flag("FardeskNoBottomBar")
    static let noGlass = flag("FardeskNoGlass")
    static let inlineTitle = flag("FardeskInlineTitle")
    static let noTimeline = flag("FardeskNoTimeline")
    static let noHubRow = flag("FardeskNoHubRow")
    static let noToolbar = flag("FardeskNoToolbar")
    static let stack = flag("FardeskStack")
    static let plainList = flag("FardeskPlainList")

    private static func flag(_ key: String) -> Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: key)
        #else
        false
        #endif
    }
}

/// The one clock of the session list: relative times ("3 min ago") and dimming read `now` from here, and it
/// moves every `period` seconds, so the list has one timer instead of one per row (none with `-FardeskNoTimeline`).
@MainActor
@Observable
final class SharedClock {
    static let period: Duration = .seconds(30)

    private(set) var now = Date()

    /// Ticks until the calling task is cancelled (the list's `.task`).
    func run() async {
        now = Date()
        guard !DebugFlags.noTimeline else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: Self.period)
            guard !Task.isCancelled else { return }
            now = Date()
        }
    }
}

extension View {
    /// The glass capsule of the bottom bar and the toast (a plain bar background with `-FardeskNoGlass`).
    @ViewBuilder
    func fardeskGlassCapsule() -> some View {
        if DebugFlags.noGlass {
            background(.bar, in: .capsule)
        } else {
            glassEffect(.regular, in: .capsule)
        }
    }
}
