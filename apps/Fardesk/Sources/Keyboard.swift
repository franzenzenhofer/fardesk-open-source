#if os(iOS)
import UIKit
#endif

/// Closes the on-screen keyboard (a tap into the chat thread means "I am reading now").
@MainActor
enum Keyboard {
    static func dismiss() {
        #if os(iOS)
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }
}
