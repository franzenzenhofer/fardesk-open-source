import FardeskFixtures
import FardeskModels
import FardeskStore
import Foundation
import Testing

struct OutboxAndStepTests {
    private let ref = SessionRef(machineID: UUID(), sessionID: "s1")

    @Test func aMessageIsQueuedThenSendingThenSentWithItsWords() {
        var outbox = Outbox()
        let id = outbox.add(OutgoingMessage(text: "hello"), to: ref, kind: .reply, at: Date())
        #expect(outbox.pending(for: ref).first?.statusLabel == "Queued")
        #expect(outbox.pending(for: ref).first?.symbolName == "clock")
        outbox.set(id, .sending)
        #expect(outbox.message(id)?.statusLabel == "Sending..." && outbox.message(id)?.isInFlight == true)
        outbox.set(id, .sent)
        #expect(outbox.message(id)?.statusLabel == "Sent" && outbox.message(id)?.symbolName == "checkmark")
        outbox.set(id, .failed("no route"))
        #expect(outbox.message(id)?.statusLabel == "Not sent: no route" && outbox.message(id)?.canRetry == true)
        outbox.set(id, .queued(waitingFor: "Linux"))
        #expect(outbox.message(id)?.statusLabel == "Queued - waiting for Linux")
        #expect(outbox.queued(on: ref.machineID).count == 1)
        #expect(outbox.queued(on: UUID()).isEmpty)
    }

    @Test func aTranscriptRowThatRepeatsTheMessageIsShownOnceAsGotIt() throws {
        var outbox = Outbox()
        let sentAt = Date()
        let id = outbox.add(OutgoingMessage(text: "fix the tests"), to: ref, kind: .reply, at: sentAt)
        outbox.set(id, .sent)
        let unrelated = try Fixtures.userRow("something else", id: "u0", at: sentAt.addingTimeInterval(1))
        let old = try Fixtures.userRow("fix the tests", id: "u-old", at: sentAt.addingTimeInterval(-3_600))
        outbox.reconcile(ref, rows: [unrelated, old])
        #expect(outbox.pending(for: ref).count == 1, "neither another text nor an hour-old repeat is this message")
        let arrived = try Fixtures.userRow("fix the tests\n\nAttached: /tmp/a.png", id: "u1", at: sentAt.addingTimeInterval(2))
        outbox.reconcile(ref, rows: [unrelated, arrived])
        #expect(outbox.pending(for: ref).isEmpty)
        #expect(outbox.isDelivered(rowID: "u1") && !outbox.isDelivered(rowID: "u0"))
        #expect(Outbox.gotItLabel == "Claude got it")
    }

    @Test func aMessageThatFailedOverTheWireButArrivedIsStillDelivered() throws {
        var outbox = Outbox()
        let id = outbox.add(OutgoingMessage(text: "ping"), to: ref, kind: .reply, at: Date())
        outbox.set(id, .failed("timed out"))
        outbox.reconcile(ref, rows: [try Fixtures.userRow("ping", id: "u9", at: Date())])
        #expect(outbox.pending(for: ref).isEmpty && outbox.isDelivered(rowID: "u9"))
    }

    @Test func theCoordinatorsFirstMessageMovesToTheSessionItStarted() {
        var outbox = Outbox()
        let pending = SessionRef.pendingCoordinator(on: ref.machineID)
        let id = outbox.add(OutgoingMessage(text: "what needs me?"), to: pending, kind: .coordinator, at: Date())
        outbox.move(id, to: ref)
        #expect(outbox.pending(for: pending).isEmpty)
        #expect(outbox.pending(for: ref).first?.kind == .reply)
    }

    @Test func theStepLogShowsRunningDoneAndFailedSteps() {
        var log = StepLog()
        #expect(!log.isVisible(feedHasRows: false))
        let start = log.begin("Starting Claude on Linux...")
        #expect(log.isRunning && log.steps[0].symbolName == nil)
        log.finish(start, as: "Session started (abc123)")
        let wait = log.begin("Waiting for the first answer...")
        #expect(log.steps[0].symbolName == "checkmark.circle.fill" && log.isVisible(feedHasRows: false))
        log.finishRunning()
        #expect(!log.isRunning && !log.isVisible(feedHasRows: true), "done and rows shown: the log leaves")
        _ = wait
        let broken = log.begin("Loading")
        log.fail(broken, reason: "timed out")
        #expect(log.hasFailure && log.steps.last?.displayText == "Loading: timed out" && log.isVisible(feedHasRows: true))
        #expect(log.steps.last?.symbolName == "xmark.circle.fill")
    }

    @Test func aStartingSessionHasItsOwnKindOfRef() {
        let machine = UUID()
        let starting = SessionRef.starting(on: machine)
        #expect(starting.isStarting && starting.machineID == machine && !starting.isPendingCoordinator)
        #expect(starting != SessionRef.starting(on: machine))
        #expect(!ref.isStarting)
    }

    @Test func theFeedFollowsTheBottomAndAnnouncesOnlyWhenScrolledUp() {
        #expect(FeedPinning.onNewRows(userJustSent: true, isNearBottom: false, contentFitsViewport: false) == .scrollToBottom)
        #expect(FeedPinning.onNewRows(userJustSent: false, isNearBottom: true, contentFitsViewport: false) == .scrollToBottom)
        #expect(FeedPinning.onNewRows(userJustSent: false, isNearBottom: false, contentFitsViewport: false) == .showNewActivityPill)
        #expect(FeedPinning.onNewRows(userJustSent: false, isNearBottom: false, contentFitsViewport: true) == .nothing, "a short feed has no pill")
        #expect(FeedPinning.pillVisible(hasNewActivity: true, isNearBottom: false, contentFitsViewport: false))
        #expect(!FeedPinning.pillVisible(hasNewActivity: true, isNearBottom: true, contentFitsViewport: false))
        #expect(!FeedPinning.pillVisible(hasNewActivity: true, isNearBottom: false, contentFitsViewport: true))
        #expect(!FeedPinning.pillVisible(hasNewActivity: false, isNearBottom: false, contentFitsViewport: false))
    }

    @Test func theHubBannerNeverLeavesTheScreenWithoutWords() {
        #expect(HubStatus.connecting.bannerText(hubName: "Linux", address: "100.64.0.10") == "Connecting to the hub (Linux)...")
        #expect(HubStatus.connecting.showsSpinner)
        let down = HubStatus.unreachable(reason: "The request timed out.")
        #expect(down.bannerText(hubName: "Linux", address: "100.64.0.10") == "Can't reach the hub (Linux, 100.64.0.10): The request timed out.. Retrying...")
        #expect(!down.showsSpinner && down.isUnreachable)
        #expect(HubStatus.reachable.bannerText(hubName: "Linux", address: "x") == nil)
    }

    @Test func theNewSessionSheetPicksAMachineAgainWhenOneComesOnline() {
        let a = UUID(), b = UUID()
        #expect(NewSessionPresentation.defaultMachine(current: nil, online: []) == nil)
        #expect(NewSessionPresentation.defaultMachine(current: nil, online: [a, b]) == a)
        #expect(NewSessionPresentation.defaultMachine(current: b, online: [a, b]) == b)
        #expect(NewSessionPresentation.defaultMachine(current: b, online: [a]) == a)
        #expect(NewSessionPresentation.noMachineNotice(onlineCount: 0, hubStatus: .connecting) == "No machine is online yet - connecting to the hub...")
        #expect(NewSessionPresentation.noMachineNotice(onlineCount: 0, hubStatus: .unreachable(reason: "x"))?.contains("does not answer") == true)
        #expect(NewSessionPresentation.noMachineNotice(onlineCount: 1, hubStatus: .reachable) == nil)
    }

    @Test func theCoordinatorAlwaysHasAMachineToOpenOn() throws {
        #expect(CoordinatorPresentation.defaultMachine(in: []) == nil)
        var other = MachineState(endpoint: Fixtures.endpoint("Mac mini Pro"))
        var hub = MachineState(endpoint: Fixtures.endpoint("Linux", host: "192.0.2.11"))
        #expect(CoordinatorPresentation.defaultMachine(in: [other, hub])?.endpoint.name == "Mac mini Pro", "offline machines still open the screen")
        hub.apply(hub: HubMachine(name: "Linux", online: true, hub: true))
        other.apply(hub: HubMachine(name: "Mac mini Pro", online: true))
        #expect(CoordinatorPresentation.defaultMachine(in: [other, hub])?.endpoint.name == "Linux", "in hub mode the hub runs the coordinator")
    }

    @Test func actionFeedbackNamesMachineAndAction() {
        #expect(ActionFeedback.running("send the message", machine: "Linux").text == "Send the message on Linux...")
        #expect(ActionFeedback.succeeded("stop the session", machine: "Linux").text == "Stop the session on Linux: done")
        let failed = ActionFeedback.failed("kill the session", machine: "Linux", reason: "no such pid")
        #expect(failed.text == "Could not kill the session on Linux: no such pid" && failed.state == .failed)
    }
}
