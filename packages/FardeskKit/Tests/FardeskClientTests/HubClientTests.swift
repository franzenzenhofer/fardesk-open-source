import FardeskFixtures
@testable import FardeskClient
import FardeskModels
import FardeskTestDaemon
import Foundation
import Testing

/// The client against a REAL hub daemon: path prefixes, the hub route, machine_offline, the stream relay.
struct HubClientTests {
    private func peerAPI(_ rig: HubRig, name: String = HubRig.peerName) -> FardeskAPI {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let base = URL(string: "\(rig.hub.url.absoluteString)/m/\(encoded)")!
        return FardeskAPI(baseURL: base, token: TestDaemon.token, timeout: 5)
    }

    @Test func hubRouteListsTheHubFirstThenEveryPeer() async throws {
        try await HubRig.with { rig in
            let state = try await rig.hubAPI.hub()
            #expect(state.hub == HubRig.hubName)
            #expect(state.machines.map(\.name) == [HubRig.hubName, HubRig.peerName, HubRig.deadName])
            #expect(state.machines[0].hub)
            #expect(state.machines[1].online)
            let dead = state.machines[2]
            #expect(!dead.online)
            #expect(dead.problem?.isEmpty == false)
        }
    }

    @Test func aBaseURLPathPrefixIsKeptForHTTPCalls() async throws {
        try await HubRig.with { rig in
            let api = peerAPI(rig)
            #expect(api.pathPrefix == "/m/Peer%20A")
            #expect(try await api.machine().name == HubRig.peerName)
            let sessions = try await api.sessions()
            #expect(Set(sessions.map(\.id)) == Set(SeedSession.standard.map(\.id)))
            let page = try await api.activity(sessionID: SeedSession.editsSessionID, limit: 5)
            #expect(page.items.count == 5)
        }
    }

    @Test func aBaseURLWithTrailingSlashDoesNotDoubleIt() {
        let api = FardeskAPI(baseURL: URL(string: "http://127.0.0.1:1/m/x/")!, token: nil)
        #expect(api.pathPrefix == "/m/x")
        #expect(FardeskAPI(baseURL: URL(string: "http://127.0.0.1:1")!, token: nil).pathPrefix == "")
    }

    @Test func theStreamURLKeepsThePrefixAndRelaysThePeersHello() async throws {
        try await HubRig.with { rig in
            let events = EventStream(api: peerAPI(rig)).events()
            var machineName: String?
            for try await event in events {
                if case .hello(let machine, _) = event {
                    machineName = machine.name
                    break
                }
            }
            #expect(machineName == HubRig.peerName)
        }
    }

    @Test func anOfflineMachineAnswersMachineOfflineAtOnce() async throws {
        try await HubRig.with { rig in
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await peerAPI(rig, name: HubRig.deadName).sessions()
            }
            #expect(error.code == .machineOffline)
            #expect(error.status == 503)
        }
    }

    @Test func clearIsRoutedToTheDaemon() async throws {
        try await HubRig.with { rig in
            let error = try await #require(throws: FardeskAPIError.self) {
                _ = try await peerAPI(rig).clear(sessionID: SeedSession.endedSessionID)
            }
            #expect(error.code == .conflict)
        }
    }

    @Test func pausingNotificationsIsPerMachineAndResumes() async throws {
        try await TestDaemon.with { daemon in
            let api = apiFor(daemon)
            #expect(try await api.notifications().pausedUntil == nil)
            let paused = try await api.pauseNotifications(minutes: 60)
            let until = try #require(paused.pausedUntil)
            #expect(until.timeIntervalSinceNow > 59 * 60)
            #expect(try await api.notifications().pausedUntil == until)
            #expect(try await api.pauseNotifications(minutes: 0).pausedUntil == nil)
        }
    }
}
