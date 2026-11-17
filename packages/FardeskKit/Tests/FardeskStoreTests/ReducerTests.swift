import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

private func userActivity(id: String, at seconds: Double, text: String = "hi") throws -> Activity {
    let ts = FardeskJSON.makeEncoderDate(t0.addingTimeInterval(seconds))
    return try Fixtures.decode(
        Activity.self, "Activity", "user", overriding: ["id": id, "ts": ts, "text": text]
    )
}

extension FardeskJSON {
    static func makeEncoderDate(_ date: Date) -> String {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)
    }
}

struct MachineStateReducerTests {
    private func helloState() throws -> MachineState {
        var state = MachineState(endpoint: Fixtures.endpoint("Studio"))
        state.apply(try Fixtures.event("helloWithSessions"))
        return state
    }

    @Test func newStateIsConnectingAndEmpty() {
        let state = MachineState(endpoint: Fixtures.endpoint("Studio"))
        #expect(state.connection == .connecting)
        #expect(!state.isOnline)
        #expect(state.machine == nil)
        #expect(state.sessions.isEmpty)
        #expect(state.id == state.endpoint.id)
    }

    @Test func helloReplacesMachineAndSessionsAndGoesOnline() throws {
        var state = try helloState()
        #expect(state.isOnline)
        #expect(state.machine?.name == "Studio Mac")
        #expect(state.sessions.count == 8)
        state.apply(try Fixtures.event("helloEmpty"))
        #expect(state.sessions.isEmpty)
        #expect(state.isOnline)
    }

    @Test func sessionEventUpsertsById() throws {
        var state = try helloState()
        let original = state.sessions
        let changed = try Fixtures.session("working", overriding: ["title": "Renamed"])
        state.apply(.session(changed))
        #expect(state.sessions.count == original.count)
        #expect(state.sessions.first { $0.id == changed.id }?.title == "Renamed")
        #expect(state.sessions.map(\.id) == original.map(\.id))

        let fresh = try Fixtures.session("working", overriding: ["id": "sess_new"])
        state.apply(.session(fresh))
        #expect(state.sessions.last == fresh)
        #expect(state.sessions.count == original.count + 1)
    }

    @Test func activityEventIsNotMachineState() throws {
        var state = try helloState()
        let before = state
        let event = StreamEvent.activity(sessionId: "sess_7f3a91", activity: try userActivity(id: "a1", at: 0))
        #expect(!state.wouldChange(by: event))
        state.apply(event)
        #expect(state == before)
    }

    @Test func pingOnlyRefreshesLastSeen() throws {
        var state = try helloState()
        let before = state.sessions
        state.apply(.ping(ts: t0))
        #expect(state.lastSeen == t0)
        #expect(state.sessions == before)
        #expect(state.connection == .online)
    }

    @Test func markOfflineRemembersLastSeenAndKeepsCachedSessions() throws {
        var pinged = try helloState()
        pinged.apply(.ping(ts: t0))
        pinged.markOffline(now: t0.addingTimeInterval(100))
        #expect(pinged.connection == .offline(lastSeen: t0))
        #expect(pinged.sessions.count == 8)

        var silent = try helloState()
        silent.markOffline(now: t0)
        #expect(silent.connection == .offline(lastSeen: t0))

        silent.markOffline(now: t0.addingTimeInterval(500))
        #expect(silent.connection == .offline(lastSeen: t0))
    }

    @Test func markOfflineWhileConnectingHasNoLastSeenUnlessPinged() {
        var state = MachineState(endpoint: Fixtures.endpoint("Studio"))
        state.markOffline(now: t0)
        #expect(state.connection == .offline(lastSeen: nil))
        state.markConnecting()
        #expect(state.connection == .connecting)
        state.apply(.ping(ts: t0))
        state.markOffline(now: t0.addingTimeInterval(9))
        #expect(state.connection == .offline(lastSeen: t0))
    }

}

struct AppStateReducerTests {
    private let linux = Fixtures.endpoint("Linux", host: "192.0.2.1")
    private let mac = Fixtures.endpoint("Mac", host: "192.0.2.2")

    @Test func eventsReachOnlyTheNamedMachine() throws {
        var state = AppState(endpoints: [linux, mac])
        try state.apply(try Fixtures.event("helloWithSessions"), from: mac.id)
        #expect(try state.machine(id: mac.id).isOnline)
        #expect(try state.machine(id: linux.id).connection == .connecting)
        #expect(state.machines.map(\.endpoint.name) == ["Linux", "Mac"])
    }

    @Test func unknownMachineFailsLoudly() throws {
        var state = AppState(endpoints: [linux])
        let stranger = UUID()
        let hello = try Fixtures.event("helloEmpty")
        let expected = AppStateError.unknownMachine(stranger)
        #expect(throws: expected) { try state.apply(hello, from: stranger) }
        #expect(throws: expected) { try state.markOffline(machineID: stranger, now: t0) }
        #expect(throws: expected) { try state.markConnecting(machineID: stranger) }
        #expect(throws: expected) { try state.machine(id: stranger) }
        #expect(expected.errorDescription?.contains(stranger.uuidString) == true)
    }

    @Test func offlineAndConnectingTransitionsApplyToOneMachine() throws {
        var state = AppState(endpoints: [linux, mac])
        try state.apply(try Fixtures.event("helloEmpty"), from: linux.id)
        try state.markOffline(machineID: linux.id, now: t0)
        #expect(try state.machine(id: linux.id).connection == .offline(lastSeen: t0))
        try state.markConnecting(machineID: linux.id)
        #expect(try state.machine(id: linux.id).connection == .connecting)
    }

    @Test func waitingSnapshotRoundTripsAsJsonForTheWidget() throws {
        var state = AppState(endpoints: [linux])
        try state.apply(try Fixtures.event("helloWithSessions"), from: linux.id)
        let snapshot = WaitingSnapshot(state: state, now: t0)
        #expect(snapshot.count == state.needsYouCount)
        #expect(snapshot.titles == state.needsYouSessions.map(\.session.title))
        let back = try WaitingSnapshot.decode(try snapshot.encoded())
        #expect(back == snapshot)
    }

    @Test func needsYouCountsWaitingSessionsOnOnlineMachinesOnly() throws {
        var state = AppState(endpoints: [linux, mac])
        #expect(state.needsYouCount == 0)
        try state.apply(try Fixtures.event("helloWithSessions"), from: linux.id)
        try state.apply(try Fixtures.event("helloWithSessions"), from: mac.id)
        #expect(state.needsYouCount == 4)
        #expect(state.needsYouSessions.map(\.machineName) == ["Linux", "Linux", "Mac", "Mac"])
        #expect(state.needsYouSessions.first?.session.status == .waiting)
        #expect(state.needsYouSessions.first?.machineID == linux.id)
        try state.markOffline(machineID: mac.id, now: t0)
        #expect(state.needsYouCount == 2)
        try state.markConnecting(machineID: linux.id)
        #expect(state.needsYouCount == 0)
    }
}

struct FeedReducerOrderTests {
    @Test func outOfOrderTimestampsEndUpChronological() throws {
        var feed = SessionFeed()
        for (id, at) in [("c", 30.0), ("a", 10.0), ("d", 40.0), ("b", 20.0)] {
            feed.upsert(try userActivity(id: id, at: at))
        }
        #expect(feed.activities.map(\.id) == ["a", "b", "c", "d"])
    }

    @Test func equalTimestampsKeepArrivalOrder() throws {
        var feed = SessionFeed()
        for id in ["x", "y", "z"] {
            feed.upsert(try userActivity(id: id, at: 5))
        }
        #expect(feed.activities.map(\.id) == ["x", "y", "z"])
    }

    @Test func replacingKeepsPositionEvenWhenTimestampChanges() throws {
        var feed = SessionFeed()
        for (id, at) in [("a", 1.0), ("b", 2.0), ("c", 3.0)] {
            feed.upsert(try userActivity(id: id, at: at))
        }
        feed.upsert(try userActivity(id: "a", at: 99, text: "late"))
        #expect(feed.activities.map(\.id) == ["a", "b", "c"])
    }
}
