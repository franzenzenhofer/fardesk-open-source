import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// The 4.1 rules of docs/design/STATES.md: every "needs you" opens on something to act on, the row edge says what is
/// live, a stopped chat offers its three ways on, Fix it runs where it can.
struct AttentionAndRowTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: Attention

    @Test func everyWaitingSessionWithoutARequestCardGetsACard() throws {
        let terminal = try Fixtures.session("waitingPermission", overriding: ["waitingFor": "terminal", "summary": "Needs you at the computer: trust prompt"])
        #expect(AttentionCard.resolve(session: terminal, feedShowsRequest: false) == .atComputer(dialog: "trust prompt"))
        let bare = try Fixtures.session("waitingPermission", overriding: ["waitingFor": "terminal", "summary": "Needs you at the computer"])
        #expect(AttentionCard.resolve(session: bare, feedShowsRequest: false) == .atComputer(dialog: "A question is open in its terminal."))
        let noReason = try Fixtures.session("waitingPermission", overriding: ["waitingFor": NSNull()])
        #expect(AttentionCard.resolve(session: noReason, feedShowsRequest: false) != nil)
        let permission = try Fixtures.session("waitingPermission")
        #expect(AttentionCard.resolve(session: permission, feedShowsRequest: false) == .loadingRequest("Loading the approval it waits for..."))
        let question = try Fixtures.session("waitingQuestion")
        #expect(AttentionCard.resolve(session: question, feedShowsRequest: false) == .loadingRequest("Loading the question it waits for..."))
    }

    @Test func noExtraCardWhenTheFeedShowsTheRequestOrNothingWaits() throws {
        #expect(AttentionCard.resolve(session: try Fixtures.session("waitingPermission"), feedShowsRequest: true) == nil)
        for name in ["working", "idleResume", "endedTakeover"] {
            #expect(AttentionCard.resolve(session: try Fixtures.session(name), feedShowsRequest: false) == nil, "\(name)")
        }
    }

    @Test func aRefreshDropsCachedRequestsTheDaemonNoLongerLists() throws {
        let text = try Fixtures.activity("assistant")
        let pending = try Fixtures.activity("permissionPending")
        var feed = SessionFeed(page: try Fixtures.page(items: [text, pending], nextBefore: nil))
        #expect(feed.pendingRequests.count == 1)
        let changed = feed.refresh(with: try Fixtures.page(items: [text], nextBefore: nil))
        #expect(changed)
        #expect(feed.pendingRequests.isEmpty, "an answered request leaves no card behind")
        #expect(feed.activities.map(\.id) == [text.id])
    }

    // MARK: Background work

    @Test func aFinishedTurnWithBackgroundJobsStillSaysWorking() throws {
        let session = try Fixtures.session("idleBackground")
        #expect(session.status == .idle && session.background == 2)
        let presentation = SessionPresentation(session: session, now: now)
        #expect(presentation.statusLabel == "In background")
        let glyph = SessionRowGlyph(session: session)
        #expect(glyph.symbolName == "ellipsis.circle" && glyph.tint == .ok)
        let done = try Fixtures.session("idleResume")
        #expect(done.background == 0 && SessionPresentation(session: done, now: now).statusLabel == "Your turn")
    }

    // MARK: List row (owner design kit 2026-11-22)

    private let noLabel: [String: any Sendable] = ["label": ["name": NSNull(), "color": NSNull(), "pinned": false] as [String: any Sendable]]

    @Test func eachStateHasItsOwnBadge() throws {
        let badges = try ["working", "idleBackground", "waitingPermission", "waitingTerminal", "idleResume", "endedTakeover"]
            .map { SessionBadge(session: try Fixtures.session($0)) }
        #expect(badges == [.working, .background, .needsYou, .needsYou, .yourTurn, .stopped])
    }

    @Test func thePreviewIsTheStateWordThenTheNewestLineOnOneLine() throws {
        let session = try Fixtures.session("working", overriding: ["summary": "After that\nI'll fix\n\nthe tasks file"])
        let row = SessionRowModel(session: session, now: now)
        #expect(row.preview == "Working · After that I'll fix the tasks file")
        #expect(SessionRowModel(session: try Fixtures.session("endedTakeover"), now: now).preview == "Stopped", "no dot without a line")
    }

    @Test func runningRowsLeaveTheTimeOutTheOthersShowIt() throws {
        #expect(SessionRowModel(session: try Fixtures.session("working"), now: now).time == nil)
        #expect(SessionRowModel(session: try Fixtures.session("idleBackground"), now: now).time == nil)
        for name in ["idleResume", "endedTakeover", "waitingQuestion"] {
            #expect(SessionRowModel(session: try Fixtures.session(name), now: now).time != nil, "\(name)")
        }
    }

    @Test func voiceOverReadsTitleAgentStateTimeAndPin() throws {
        let pinned: [String: any Sendable] = ["label": ["name": "Workshop", "color": NSNull(), "pinned": true] as [String: any Sendable]]
        let row = SessionRowModel(session: try Fixtures.session("endedTakeover", overriding: pinned), now: now)
        #expect(row.pinned)
        #expect(row.accessibilityLabel == "Workshop, Claude, Stopped, \(try #require(row.time)), Pinned")
    }

    @Test func automaticColoursShowOnlyWhenSwitchedOn() throws {
        let auto = noLabel.merging(["autoColor": "#1AA1FB"]) { a, _ in a }
        let session = try Fixtures.session("working", overriding: auto)
        #expect(session.shownColor(automatic: false) == nil)
        #expect(session.shownColor(automatic: true) == (try #require(LabelColor(hex: "#1AA1FB"))))
    }

    // MARK: Stopped chat footer

    @Test func aStoppedChatOffersItsThreeWaysOn() throws {
        #expect(StoppedFooter.Choice.allCases.map(\.title) == ["Resume", "Resume from summary", "Start fresh here"])
        let session = try Fixtures.session("endedTakeover", overriding: ["updatedAt": "2027-01-15T06:00:00Z", "contextTokens": NSNull()])
        let line = StoppedFooter.statusLine(session, now: try #require(ISO8601DateFormatter().date(from: "2027-01-15T08:00:00Z")))
        #expect(line == "Stopped 2 h ago. You can continue it.")
    }

    // MARK: Fix it

    @Test func fixItRunsOnTheSessionsComputerElseOnTheCoordinator() {
        let mac = UUID(), hub = UUID()
        #expect(FixItPlan.decide(sessionMachineOnline: true, sessionMachine: mac, hub: hub, hubOnline: true, coordinatorEnabled: true) == .onMachine(mac))
        #expect(FixItPlan.decide(sessionMachineOnline: false, sessionMachine: mac, hub: hub, hubOnline: true, coordinatorEnabled: true) == .onCoordinator(hub))
        #expect(FixItPlan.decide(sessionMachineOnline: false, sessionMachine: mac, hub: hub, hubOnline: false, coordinatorEnabled: true) == .nowhere)
        #expect(FixItPlan.decide(sessionMachineOnline: false, sessionMachine: mac, hub: hub, hubOnline: true, coordinatorEnabled: false) == .nowhere)
        #expect(FixItPlan.decide(sessionMachineOnline: false, sessionMachine: hub, hub: hub, hubOnline: false, coordinatorEnabled: true) == .nowhere)
        #expect(FixItPlan.decide(sessionMachineOnline: false, sessionMachine: mac, hub: nil, hubOnline: false, coordinatorEnabled: true) == .nowhere)
    }

    /// The coordinator gets everything it needs to make and set the picture itself, and nothing to change otherwise.
    @Test func theImageRequestNamesTheChatTheMachineAndTheTool() throws {
        let session = try Fixtures.session("idleResume")
        let prompt = ChatImageRequest.prompt(for: session, machineName: "Studio")
        #expect(prompt.contains(session.id) && prompt.contains("\"Studio\"") && prompt.contains(session.displayTitle))
        #expect(prompt.contains("set_session_image") && prompt.contains("no text") && prompt.contains("Do not change anything else"))
    }

    /// "Start fresh here" opens New Session with everything of the stopped chat filled in; only the message is left.
    @Test func startFreshFillsTheNewSessionScreenFromTheStoppedChat() throws {
        let stopped = try Fixtures.session("endedTakeover")
        let machine = UUID()
        let draft = NewSessionDraft.startingFresh(from: stopped, on: machine)
        #expect(draft.machineID == machine && draft.cwd == stopped.cwd && draft.homeName == stopped.home)
        #expect(draft.permissionMode == (stopped.permissionMode ?? .default) && draft.modelName == stopped.model)
        #expect(!draft.canStart, "nothing starts before the first message is written")
        var written = draft
        written.prompt = "Go on with the tests"
        #expect(written.canStart)
    }

    /// The fixing chat is named after the chat it fixes, so it is found again in the list.
    @Test func aFixItChatIsNamedAfterTheChatItFixes() throws {
        let stuck = try Fixtures.session("waitingTerminal", overriding: ["label": ["name": "Workshop", "color": NSNull(), "pinned": false] as [String: any Sendable]])
        #expect(FixItPlan.name(for: stuck) == "Fix it: Workshop")
        let long = try Fixtures.session("waitingTerminal", overriding: ["label": ["name": String(repeating: "x", count: 80), "color": NSNull(), "pinned": false] as [String: any Sendable]])
        #expect(FixItPlan.name(for: long).count == SessionLabelName.maxLength, "never longer than a name may be")
    }

    @Test func theFixItPromptNamesTheSessionAndForbidsProjectChanges() throws {
        let session = try Fixtures.session("waitingPermission", overriding: ["waitingFor": "terminal", "summary": "Needs you at the computer: trust prompt"])
        let local = FixItPlan.prompt(for: session, machineName: "Studio", remote: false)
        #expect(local.contains(session.id) && local.contains(session.cwd))
        #expect(local.contains("Needs you at the computer: trust prompt"))
        #expect(local.contains("Do not change any project files."))
        #expect(local.contains("It runs on this computer."))
        #expect(FixItPlan.prompt(for: session, machineName: "Studio", remote: true).contains("\"Studio\""))
    }
}
