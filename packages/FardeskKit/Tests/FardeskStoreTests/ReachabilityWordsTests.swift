import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// 4.1.0 (#122): an offline computer says plainly why it cannot be reached.
struct ReachabilityWordsTests {
    private let now = Date(timeIntervalSince1970: 10_000)

    @Test func tailscaleOffHereIsNamedFirst() {
        let reason = OfflineReason(machineName: "Studio", hubProblem: "connection refused", tailscaleIsOnHere: false)
        #expect(reason.title == "Studio is not reachable")
        #expect(reason.reason == "Tailscale is turned off on this device.")
    }

    @Test func theHubsReasonWinsWhenThereIsOne() {
        let reason = OfflineReason(machineName: "Studio", hubProblem: "The Fardesk service on this computer is not running.", tailscaleIsOnHere: true)
        #expect(reason.reason == "The Fardesk service on this computer is not running.")
        #expect(reason.whatToDo.contains("reconnects by itself"))
    }

    @Test func withoutAHubTheReasonListsWhatToCheck() {
        let reason = OfflineReason(machineName: "Studio", hubProblem: nil, tailscaleIsOnHere: true)
        #expect(reason.reason.contains("Tailscale may be turned off there"))
        #expect(reason.whatToDo.hasPrefix("Wake Studio"))
    }
}
