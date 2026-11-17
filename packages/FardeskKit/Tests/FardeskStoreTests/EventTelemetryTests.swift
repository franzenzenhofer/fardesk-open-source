import FardeskClient
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Events travel the same queue as errors and reach a REAL daemon, which hands them back by kind.
@MainActor
struct EventTelemetryTests {
    @Test func eventsAreQueuedWithoutTheErrorDeduplication() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            let machine = UUID()
            let started = Date().addingTimeInterval(-0.25)
            model.recordEvent("session.open", "cache hit, content shown", machineID: machine, sessionID: "s1", since: started)
            model.recordEvent("session.open", "cache hit, content shown", machineID: machine, sessionID: "s1", since: started)
            let pending = model.configuration.telemetry.pending
            #expect(pending.count == 2)
            #expect(pending.allSatisfy { $0.kind == .event })
            #expect((pending.first?.durationMs ?? 0) >= 250)
            #expect(pending.first?.sessionId == "s1")
        }
    }

    private static func editsRef(_ endpoint: MachineEndpoint) -> SessionRef {
        SessionRef(machineID: endpoint.id, sessionID: SeedSession.editsSessionID)
    }

    @Test func openingASessionActionsAndStreamsAreReportedAndDelivered() async throws {
        try await TestDaemon.with { daemon in
            try await StoreSandbox.with { sandbox in
                let (model, endpoint) = try await readyModel(daemon, sandbox)
                let ref = Self.editsRef(endpoint)
                await model.openSession(ref)
                await model.openSession(ref)
                _ = await model.stop(ref)
                await model.flushTelemetry()
                let events = try await FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5).telemetry(kind: .event).reports
                let areas = Set(events.map(\.area))
                #expect(areas.isSuperset(of: ["app", "stream", "session.open", "action"]))
                let opens = events.filter { $0.area == "session.open" }
                #expect(opens.contains { $0.message.contains("cache miss") })
                #expect(opens.contains { $0.message.contains("cache hit") })
                #expect(opens.allSatisfy { $0.durationMs != nil && $0.sessionId == ref.sessionID })
                #expect(try await FardeskAPI(baseURL: daemon.url, token: TestDaemon.token, timeout: 5).telemetry(kind: .error).reports.allSatisfy { $0.kind != .event })
                model.stop()
            }
        }
    }

    @Test func aMachineGoingOfflineThroughTheHubIsAnEvent() async throws {
        try await HubRig.with { rig in
            try await StoreSandbox.with { sandbox in
                try sandbox.keychainTokens.save(TestDaemon.token, HubIdentity.tokenID(hub: rig.hub.url))
                let model = AppModel(configuration: sandbox.configuration(hubURL: rig.hub.url))
                await model.start()
                _ = try await waitUntil { await MainActor.run { model.machines.endpoints.count == 3 } }
                await rig.peer.stop()
                let seen = try await waitUntil(timeout: .seconds(20)) {
                    await MainActor.run {
                        model.configuration.telemetry.pending.contains { $0.area == "hub" && $0.message.contains("\(HubRig.peerName) went offline") }
                    }
                }
                #expect(seen)
                model.stop()
            }
        }
    }
}
