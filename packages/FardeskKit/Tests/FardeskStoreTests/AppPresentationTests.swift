import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct AppPresentationTests {
    private let endpoint = MachineEndpoint(name: "Mac", url: URL(string: "http://127.0.0.1:1")!)
    private let now = Date(timeIntervalSince1970: 10_000)

    @Test func connectingMachineIsNeitherOnlineNorDimmed() {
        let presentation = MachinePresentation(machine: MachineState(endpoint: endpoint), now: now)
        #expect(presentation.statusLabel == "Connecting")
        #expect(!presentation.isOnline && !presentation.isDimmed)
        #expect(presentation.state == .inactive)
        #expect(presentation.lastSeenLabel == nil)
    }

    @Test func offlineMachineShowsLastSeen() {
        var machine = MachineState(endpoint: endpoint)
        machine.restore(MachineSnapshot(machineID: endpoint.id, machine: nil, sessions: [], lastSeen: now.addingTimeInterval(-300)))
        let presentation = MachinePresentation(machine: machine, now: now)
        #expect(presentation.statusLabel == "Offline")
        #expect(presentation.isDimmed)
        #expect(presentation.lastSeenLabel == "Last seen 5m ago")
    }

    @Test func anOfflinePeerRowShowsTheHubsLastSeenNotThisDevicesClock() throws {
        let hubSeen = now.addingTimeInterval(-3_600)
        var machine = MachineState(endpoint: endpoint)
        machine.apply(hub: HubMachine(name: "Mac", online: true, lastSeen: hubSeen))
        machine.apply(.hello(machine: try Fixtures.machine(), sessions: []))
        machine.apply(.ping(ts: now.addingTimeInterval(-60)))
        machine.markOffline(problem: "Tailscale is stopped on it", now: now)
        let presentation = MachinePresentation(machine: machine, now: now)
        #expect(machine.connection == .offline(lastSeen: hubSeen))
        #expect(presentation.offlineSinceLabel == "since 1h ago")
        #expect(presentation.problem == "Tailscale is stopped on it")
        #expect(machine.hubInfo?.lastSeen == hubSeen)
    }

    @Test func aPeerTheHubNeverSawHasNoOfflineSince() {
        var machine = MachineState(endpoint: endpoint)
        machine.apply(hub: HubMachine(name: "Mac", online: false, lastSeen: nil, problem: "not linked"))
        let presentation = MachinePresentation(machine: machine, now: now)
        #expect(presentation.statusLabel == "Offline")
        #expect(presentation.offlineSinceLabel == nil)
    }

    @Test func offlineWithoutAnyContactHasNoLastSeen() {
        var machine = MachineState(endpoint: endpoint)
        machine.restore(MachineSnapshot(machineID: endpoint.id, machine: nil, sessions: [], lastSeen: nil))
        #expect(MachinePresentation(machine: machine, now: now).lastSeenLabel == nil)
    }

    @Test func onlineMachineIsOnline() throws {
        var machine = MachineState(endpoint: endpoint)
        machine.apply(.hello(machine: try Fixtures.machine(), sessions: []))
        let presentation = MachinePresentation(machine: machine, now: now)
        #expect(presentation.isOnline && presentation.statusLabel == "Online")
        #expect(presentation.state == .ok)
    }

    @Test func notificationPreferencesDefaultToEverythingAndFollowTheStoredFlags() throws {
        let defaults = try #require(UserDefaults(suiteName: "fardesk.tests.\(UUID().uuidString)"))
        let preferences = NotificationPreferences(defaults: defaults)
        #expect(preferences.enabled == NotificationPreferences.allTypes)
        defaults.set(false, forKey: NotificationPreferences.key(for: .ended))
        #expect(preferences.enabled == [.done, .permission, .question])
        #expect(NotificationPreferences.allTypes.map(NotificationPreferences.label).allSatisfy { !$0.isEmpty })
    }
}
