import FardeskStore
import Foundation
import Observation
import SwiftUI

/// Measures, inside the app, how long a tap takes to its first visible change: the tap handler stamps the time,
/// the screen's `onAppear` reports it as an event (`fardesk events` shows "ui" rows with the milliseconds).
/// The number is the real one; a UI test's own stopwatch also counts XCUITest's waiting for the app to be idle.
/// In DEBUG builds the last number of each tap is also readable by UI tests (see `TapClockProbe`).
@MainActor
enum TapClock {
    private static var stamps: [String: Date] = [:]

    static func start(_ key: String) {
        stamps[key] = Date()
        Breadcrumbs.mark("tap \(key)")
    }

    /// Starts `key` at the moment the kernel started this process, so "launch to first session row" counts the
    /// whole cold start, not only the part after SwiftUI is up.
    static func startAtProcessLaunch(_ key: String) {
        stamps[key] = processStart
    }

    private static let processStart: Date = {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return Date() }
        let started = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(started.tv_sec) + Double(started.tv_usec) / 1_000_000)
    }()

    /// Reports the time since `start(key)` once; a screen that appears without a tap reports nothing.
    static func finish(_ key: String, model: AppModel) {
        guard let started = stamps.removeValue(forKey: key) else { return }
        model.recordEvent("ui", "\(key): tap to first visible change", since: started)
        #if DEBUG
        TapClockResults.shared.values[key] = Int((Date().timeIntervalSince(started) * 1000).rounded())
        #endif
    }
}

#if DEBUG
/// The last measured milliseconds per tap, for the UI tests.
@MainActor
@Observable
final class TapClockResults {
    static let shared = TapClockResults()
    var values: [String: Int] = [:]
}

/// One invisible accessibility element per measured tap: identifier `tapclock-<name>`, label = milliseconds.
/// UI tests assert on this number, not on their own stopwatch.
struct TapClockProbe: View {
    var body: some View {
        VStack {
            ForEach(TapClockResults.shared.values.sorted(by: { $0.key < $1.key }), id: \.key) { key, ms in
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement()
                    .accessibilityLabel("\(ms)")
                    .accessibilityIdentifier("tapclock-\(key)")
            }
        }
        .allowsHitTesting(false)
    }
}
#endif
