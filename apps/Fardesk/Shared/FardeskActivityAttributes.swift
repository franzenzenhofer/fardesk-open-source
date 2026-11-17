import FardeskStore
import Foundation

extension WaitingSnapshotStore {
    /// The file in the shared App Group container; nil when the target is not entitled to the group.
    static var appGroup: WaitingSnapshotStore? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
            .map { WaitingSnapshotStore(directory: $0) }
    }
}

#if os(iOS)
import ActivityKit

/// The Live Activity of one pinned session. Compiled into the app and into the widget extension.
struct FardeskActivityAttributes: ActivityAttributes {
    typealias ContentState = LiveActivityContent

    let machineID: UUID
    let sessionID: String

    var ref: SessionRef { SessionRef(machineID: machineID, sessionID: sessionID) }
}
#endif
