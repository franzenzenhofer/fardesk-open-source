import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

private func helloState(_ endpoint: MachineEndpoint) throws -> AppState {
    var state = AppState(endpoints: [endpoint])
    try state.apply(try Fixtures.event("helloWithSessions"), from: endpoint.id)
    return state
}

struct WaitingSnapshotTests {
    @Test func namesTheSessionThatWaitsLongest() throws {
        let linux = Fixtures.endpoint("Linux")
        let snapshot = WaitingSnapshot(state: try helloState(linux), now: t0)
        #expect(snapshot.count == 3)
        #expect(snapshot.oldestTitle == "Export dialog")
        #expect(snapshot.oldestMachine == "Linux")
    }

    @Test func emptyStateHasNoOldestSession() {
        let snapshot = WaitingSnapshot(state: AppState(), now: t0)
        #expect(snapshot.count == 0)
        #expect(snapshot.oldestTitle == nil)
        #expect(snapshot.oldestMachine == nil)
    }

    @Test func sameContentIgnoresOnlyTheTimestamp() throws {
        let linux = Fixtures.endpoint("Linux")
        let state = try helloState(linux)
        let first = WaitingSnapshot(state: state, now: t0)
        #expect(first.hasSameContent(as: WaitingSnapshot(state: state, now: t0.addingTimeInterval(60))))
        #expect(!first.hasSameContent(as: WaitingSnapshot(state: AppState(), now: t0)))
        let other = Fixtures.endpoint("Mac")
        #expect(!first.hasSameContent(as: WaitingSnapshot(state: try helloState(other), now: t0)))
    }

    @Test func decodesAFileWrittenBeforeTheOldestFieldsExisted() throws {
        let json = #"{"count":1,"titles":["A"],"updatedAt":"2026-11-14T09:00:00Z"}"#
        let snapshot = try WaitingSnapshot.decode(Data(json.utf8))
        #expect(snapshot.count == 1)
        #expect(snapshot.oldestTitle == nil)
    }
}

struct WaitingSnapshotStoreTests {
    @Test func savesReadsAndReportsChangesOnly() throws {
        let store = WaitingSnapshotStore(directory: try StoreSandbox().root)
        #expect(store.read() == nil)
        let state = try helloState(Fixtures.endpoint("Linux"))
        let first = WaitingSnapshot(state: state, now: t0)
        #expect(try store.save(first))
        #expect(store.read() == first)
        #expect(try !store.save(WaitingSnapshot(state: state, now: t0.addingTimeInterval(60))))
        #expect(store.read() == first)
        #expect(try store.save(WaitingSnapshot(state: AppState(), now: t0)))
        #expect(store.read()?.count == 0)
    }

    @Test func unreadableFileReadsAsNothing() throws {
        let root = try StoreSandbox().root
        try Data("not json".utf8).write(to: root.appending(path: "waiting-snapshot.json"))
        #expect(WaitingSnapshotStore(directory: root).read() == nil)
    }

    @Test func appGroupIdComesFromTheInfoPlist() {
        #expect(WaitingSnapshotStore.appGroupInfoKey == "FardeskAppGroup")
        #expect(WaitingSnapshotStore.groupName(infoValue: "group.com.example.fardesk") == "group.com.example.fardesk")
        #expect(WaitingSnapshotStore.groupName(infoValue: nil) == "")
        #expect(WaitingSnapshotStore.appGroupID == "")
    }
}

struct LiveActivityContentTests {
    private let linux = Fixtures.endpoint("Linux")

    private func ref(_ session: String) -> SessionRef { SessionRef(machineID: linux.id, sessionID: session) }

    private func feed(applying ids: [String]) throws -> SessionFeed {
        var feed = SessionFeed()
        let all = try Fixtures.activities()
        for id in ids {
            feed.upsert(try #require(all.first { $0.id == id }))
        }
        return feed
    }

    @Test func workingSessionShowsProjectMachineStatusAndNewestToolRow() throws {
        let feed = try feed(applying: ["act_0001", "act_0004", "act_0014"])
        let content = try #require(LiveActivityContent.make(state: try helloState(linux), ref: ref("sess_7f3a91"), feed: feed))
        #expect(content.projectName == "Smear brush engine")
        #expect(content.machineName == "Linux")
        #expect(content.statusLabel == "Working")
        #expect(!content.isWaiting)
        #expect(content.lastToolTitle == "Ran swift test - 31 passed")
    }

    @Test func aFilesRowCountsAsAToolRow() throws {
        let feed = try feed(applying: ["act_0004", "act_0006"])
        let content = try #require(LiveActivityContent.make(state: try helloState(linux), ref: ref("sess_7f3a91"), feed: feed))
        #expect(content.lastToolTitle == "Edited PaintEngine.swift")
    }

    @Test func sessionWithoutToolRowsHasNoToolTitle() throws {
        let state = try helloState(linux)
        let content = try #require(LiveActivityContent.make(state: state, ref: ref("sess_7f3a91")))
        #expect(content.lastToolTitle == nil)
    }

    @Test func waitingSessionIsFlaggedAsWaiting() throws {
        let content = try #require(LiveActivityContent.make(state: try helloState(linux), ref: ref("sess_2c84be")))
        #expect(content.isWaiting)
        #expect(content.statusLabel != "Working")
    }

    @Test func idleEndedAndUnknownSessionsEndTheActivity() throws {
        let state = try helloState(linux)
        #expect(LiveActivityContent.make(state: state, ref: ref("sess_e5517c")) == nil)
        #expect(LiveActivityContent.make(state: state, ref: ref("sess_0b6e12")) == nil)
        #expect(LiveActivityContent.make(state: state, ref: ref("missing")) == nil)
        let unknownMachine = SessionRef(machineID: UUID(), sessionID: "sess_7f3a91")
        #expect(LiveActivityContent.make(state: state, ref: unknownMachine) == nil)
    }

    @Test func contentRoundTripsThroughJson() throws {
        let content = try #require(LiveActivityContent.make(state: try helloState(linux), ref: ref("sess_7f3a91")))
        let back = try JSONDecoder().decode(LiveActivityContent.self, from: JSONEncoder().encode(content))
        #expect(back == content)
    }
}
