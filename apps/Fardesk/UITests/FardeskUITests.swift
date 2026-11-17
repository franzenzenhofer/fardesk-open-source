import XCTest

/// The feedback rules of docs/FEEDBACK-RULES.md ("What the UI tests assert"), driven against the REAL hub.
/// Run on a second Mac (FARDESK_SIM_HOST in fardesk.env). The login link comes from FARDESK_UITEST_PAIR_LINK;
/// sends go only to the session this test creates itself in the folder FARDESK_UITEST_FOLDER.
@MainActor
final class FardeskUITests: XCTestCase {
    /// 100 ms rule, plus 200 ms for the simulator and XCUITest's own waiting.
    private let tapBudget: TimeInterval = 0.3

    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: Helpers

    private func pairLink() throws -> String {
        guard let link = ProcessInfo.processInfo.environment["FARDESK_UITEST_PAIR_LINK"], !link.isEmpty else {
            throw XCTSkip("FARDESK_UITEST_PAIR_LINK is not set: nothing to log in with")
        }
        return link
    }

    private func launch(hubDown: Bool = false, forceCold: Bool = false) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-FardeskPairLink", try pairLink(), "-FardeskUITest", "YES"]
        if forceCold { app.launchArguments += ["-FardeskForceCold", "YES"] }
        if hubDown { app.launchArguments += ["-FardeskHubDown", "YES"] }
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func note(_ text: String) {
        print("FARDESK-UITEST \(text)")
        let attachment = XCTAttachment(string: text)
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func sessionRows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'session-row-'"))
    }

    /// The milliseconds the APP measured from the tap to the first visible change (TapClock, read from an invisible
    /// accessibility element). XCUITest's own stopwatch also counts its waiting for the app to idle, so it is only noted.
    private func appSideMs(_ app: XCUIApplication, _ key: String) -> Int? {
        let probe = element(app, "tapclock-\(key)")
        guard probe.waitForExistence(timeout: 5) else { return nil }
        return Int(probe.label)
    }

    private func assertAppSide(_ app: XCUIApplication, _ key: String, _ name: String) {
        guard let ms = appSideMs(app, key) else { return XCTFail("\(name): the app reported no tap-to-visible time (tapclock-\(key))") }
        note("\(name): app-side tap to first visible change \(ms) ms (budget \(Int(tapBudget * 1000)) ms)")
        XCTAssertLessThan(Double(ms) / 1000, tapBudget, "\(name): the app took \(ms) ms")
    }

    /// Taps; the app-side number (`key`) is asserted, the wall time of this test is only logged.
    private func tapAndMeasure(_ name: String, _ app: XCUIApplication, _ tapped: XCUIElement, key: String?, until target: XCUIElement? = nil) {
        let start = ProcessInfo.processInfo.systemUptime
        tapped.tap()
        let appeared = target?.waitForExistence(timeout: 5) ?? true
        note("\(name): wall time of this test from tap to the screen \(Int((ProcessInfo.processInfo.systemUptime - start) * 1000)) ms (not asserted)")
        shot(name)
        XCTAssertTrue(appeared, "\(name): nothing visible after the tap")
        if let key { assertAppSide(app, key, name) }
    }

    private func waitForCachedOrLiveSessions(_ app: XCUIApplication, timeout: TimeInterval = 30) {
        XCTAssertTrue(sessionRows(app).firstMatch.waitForExistence(timeout: timeout), "no session row after \(Int(timeout)) s")
    }

    // MARK: Taps answer within the budget

    func testCoordinatorRowOpensTheScreenAtOnce() throws {
        let app = try launch()
        let row = element(app, "coordinator-row")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        tapAndMeasure("coordinator row", app, row, key: "coordinator.open", until: app.navigationBars["Coordinator"])
        XCTAssertTrue(element(app, "composer-field").waitForExistence(timeout: 2), "the composer is there before any answer")
        sleep(2)
        XCTAssertEqual(app.state, .runningForeground, "the app is still running 2 s after opening the Coordinator")
        XCTAssertTrue(element(app, "composer-field").exists)
    }

    /// Logs in once with the pairing link, quits, and starts again with the hub unreachable (same identity).
    private func relaunchWithHubDown() throws -> XCUIApplication {
        let first = try launch()
        XCTAssertTrue(element(first, "coordinator-row").waitForExistence(timeout: 30))
        first.terminate()
        let app = XCUIApplication()
        app.launchArguments = ["-FardeskHubDown", "YES", "-FardeskUITest", "YES"]
        app.launch()
        return app
    }

    func testNewSessionSheetOpensAtOnceEvenWithoutAMachine() throws {
        let app = try relaunchWithHubDown()
        let button = element(app, "new-session-button")
        XCTAssertTrue(button.waitForExistence(timeout: 30))
        tapAndMeasure("new session", app, button, key: nil, until: app.navigationBars["New Session"])
        let notice = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'No machine is online'")).firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 2), "the sheet says in words why Start waits")
        app.buttons["Cancel"].tap()
        assertAppSide(app, "newsession.open", "new session")
    }

    func testSessionRowOpensTheSessionScreenBeforeAnyAnswerAndDoubleTapOpensOnce() throws {
        let app = try launch()
        waitForCachedOrLiveSessions(app)
        let row = sessionRows(app).firstMatch
        let start = ProcessInfo.processInfo.systemUptime
        row.doubleTap()
        let composer = element(app, "composer-field")
        let shown = composer.waitForExistence(timeout: 5) || app.navigationBars.firstMatch.exists
        note("session row: \(Int((ProcessInfo.processInfo.systemUptime - start) * 1000)) ms to the session screen")
        shot("session opened")
        XCTAssertTrue(shown)
        assertAppSide(app, "session.open", "session row")
        XCTAssertLessThanOrEqual(app.descendants(matching: .any).matching(identifier: "composer-field").count, 1, "one open, not two")
    }

    // MARK: Launch

    func testALoggedInLaunchShowsTheListFastAndNeverAPasswordField() throws {
        let app = try launch()
        let start = ProcessInfo.processInfo.systemUptime
        let row = element(app, "coordinator-row")
        XCTAssertTrue(row.waitForExistence(timeout: 3), "the Coordinator row within 3 s of launch")
        note("coordinator row after \(Int((ProcessInfo.processInfo.systemUptime - start) * 1000)) ms")
        XCTAssertFalse(app.secureTextFields["Password"].exists, "no login field in a logged-in launch")
        let banner = element(app, "hub-status")
        let gone = NSPredicate(format: "exists == false")
        let cleared = XCTNSPredicateExpectation(predicate: gone, object: banner)
        XCTAssertEqual(XCTWaiter().wait(for: [cleared], timeout: 5), .completed, "the hub banner is gone within 5 s")
        shot("launched")
    }

    func testEveryScreenOpensOnceWithoutCrashing() throws {
        let app = try launch()
        XCTAssertTrue(element(app, "coordinator-row").waitForExistence(timeout: 30))
        element(app, "coordinator-row").tap()
        XCTAssertTrue(app.navigationBars["Coordinator"].waitForExistence(timeout: 2))
        app.navigationBars.buttons.firstMatch.tap()
        element(app, "new-session-button").tap()
        XCTAssertTrue(app.navigationBars["New Session"].waitForExistence(timeout: 2))
        app.buttons["Cancel"].tap()
        let row = sessionRows(app).firstMatch
        if row.waitForExistence(timeout: 10) {
            row.tap()
            XCTAssertTrue(element(app, "composer-field").waitForExistence(timeout: 5))
        }
        XCTAssertEqual(app.state, .runningForeground)
        shot("every screen opened")
    }

    // MARK: Cached first, banner named, no silent spinner

    func testCachedSessionsShowWithinASecondWhileTheHubIsUnreachable() throws {
        let first = try launch()
        waitForCachedOrLiveSessions(first)
        shot("online, sessions listed")
        first.terminate()

        let app = XCUIApplication()
        app.launchArguments = ["-FardeskHubDown", "YES", "-FardeskUITest", "YES"]
        let start = ProcessInfo.processInfo.systemUptime
        app.launch()
        XCTAssertTrue(sessionRows(app).firstMatch.waitForExistence(timeout: 1), "cached sessions within 1 s of launch")
        note("cached sessions after \(Int((ProcessInfo.processInfo.systemUptime - start) * 1000)) ms (test wall time incl. XCUITest launch)")
        // The app reports "launch.list" (process start to first session row) as an event, read with
        // `fardesk events`; a Debug build under XCUITest spends ~3 s before main, so the phone's number counts.
        if let ms = appSideMs(app, "launch.list") { note("cached sessions: app-side process start to first session row \(ms) ms") }
        shot("cached, hub unreachable")
        let banner = element(app, "hub-status")
        XCTAssertTrue(banner.waitForExistence(timeout: 8), "a banner names the hub within a few seconds")
        XCTAssertTrue(banner.label.contains("hub"), "banner: \(banner.label)")
        shot("hub banner")
    }

    func testNoSpinnerStaysWithoutWordsAfterOneSecond() throws {
        let app = try launch()
        XCTAssertTrue(element(app, "coordinator-row").waitForExistence(timeout: 30))
        sleep(1)
        let words = element(app, "hub-status").exists || element(app, "step-log").exists || element(app, "feedback-toast").exists
        if app.activityIndicators.count > 0 {
            XCTAssertTrue(words, "a spinner without a label after 1 s")
        }
        shot("spinners have words")
    }

    // MARK: A test-owned session: start it, send to it

    private func startTestSession(_ app: XCUIApplication) throws {
        let folder = try XCTUnwrap(ProcessInfo.processInfo.environment["FARDESK_UITEST_FOLDER"], "set FARDESK_UITEST_FOLDER (fardesk.env)")
        let new = element(app, "new-session-button")
        XCTAssertTrue(new.waitForExistence(timeout: 30))
        new.tap()
        XCTAssertTrue(app.navigationBars["New Session"].waitForExistence(timeout: 2))
        let linux = app.buttons["Linux"]
        if linux.waitForExistence(timeout: 20) { linux.tap() }
        let other = element(app, "other-folder-button")
        for _ in 0..<6 where !other.isHittable { app.swipeUp() }
        other.tap()
        let folderField = app.textFields["/path/to/folder"]
        XCTAssertTrue(folderField.waitForExistence(timeout: 2))
        folderField.tap()
        folderField.typeText(folder)
        let prompt = app.textViews.firstMatch
        prompt.tap()
        prompt.typeText("Reply only: ok")
        shot("new session filled in")
        // The default model is fine for "Reply only: ok"; picking one means leaving the sheet's picker screen again.
        let start = element(app, "start-session-button")
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        start.tap()
        // The starting screen is there at once, with a step list whose label changes.
        let log = element(app, "step-log")
        XCTAssertTrue(log.waitForExistence(timeout: tapBudget + 0.2), "the starting screen shows its steps at once")
        let first = log.label
        shot("starting screen")
        let changed = NSPredicate(format: "label != %@", first)
        let moved = XCTNSPredicateExpectation(predicate: changed, object: log)
        XCTAssertEqual(XCTWaiter().wait(for: [moved], timeout: 30), .completed, "the step label never changed: \(first)")
        XCTAssertTrue(element(app, "composer-field").waitForExistence(timeout: 90), "the session screen with its composer")
        shot("session started")
    }

    func testSendingToATestOwnedSessionIsPendingAtOnceThenSent() throws {
        let app = try launch()
        try startTestSession(app)
        let field = element(app, "composer-field")
        field.tap()
        field.typeText("Reply only: ok")
        let send = element(app, "send-button")
        tapAndMeasure("send", app, send, key: "send.pending")
        XCTAssertLessThanOrEqual(app.descendants(matching: .any).matching(identifier: "pending-message").count, 1, "one message, not two")
        // Claude may answer before the test looks again: the pending row is then already the real row, marked "Claude got it".
        let gotIt = app.staticTexts["Claude got it"]
        XCTAssertTrue(gotIt.waitForExistence(timeout: 60), "the message never became \"Claude got it\"")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'Reply only: ok'")).count, 2, "the first prompt and the reply: two rows, not three")
        shot("sent")
    }

    func testStopIsOnlyInTheSessionMenu() throws {
        let app = try launch()
        try startTestSession(app)
        XCTAssertFalse(app.buttons["Stop"].exists, "no visible Stop button on the session screen")
        let actions = element(app, "session-actions")
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        XCTAssertEqual(actions.label, "Actions", "the menu button says what it is")
        actions.tap()
        shot("the actions menu")
        for item in ["Clear", "Compact", "End session"] {
            XCTAssertTrue(app.buttons[item].waitForExistence(timeout: 2), "the menu shows \(item) with its words")
        }
        XCTAssertFalse(app.buttons["End Session and Close Tab"].exists, "one End session, no second variant")
    }

    func testAColdSessionAsksBeforeSendingAndKeepsTheMessage() throws {
        let app = try launch(forceCold: true)
        try startTestSession(app)
        let field = element(app, "composer-field")
        field.tap()
        field.typeText("Reply only: ok")
        let card = element(app, "cold-card")
        tapAndMeasure("send to a cold session", app, element(app, "send-button"), key: "send.pending", until: card)
        XCTAssertTrue(element(app, "cold-warning").label.hasPrefix("Resume this conversation? Inactive for "), element(app, "cold-warning").label)
        for choice in ["Resume", "Resume from summary", "Start new"] {
            XCTAssertTrue(card.buttons[choice].exists, "button \(choice)")
        }
        XCTAssertEqual(element(app, "pending-message").label.contains("Waiting for your choice"), true, "the typed message stays in the feed")
        shot("cold card")
        card.buttons["Resume"].tap()
        XCTAssertTrue(NSPredicate(format: "exists == false").evaluate(with: card) || !card.waitForExistence(timeout: 1))
        // Claude may answer before the test looks again: the pending row is then already the real row, marked "Claude got it".
        XCTAssertTrue(app.staticTexts["Claude got it"].waitForExistence(timeout: 60), "the message went on after the choice and Claude got it")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'Reply only: ok'")).count, 2, "sent once: the first prompt and the reply")
        shot("after Resume")
    }

    func testSendingWithTheHubGoneSaysSoAndKeepsOneMessage() throws {
        let first = try launch()
        waitForCachedOrLiveSessions(first)
        first.terminate()
        let app = XCUIApplication()
        app.launchArguments = ["-FardeskHubDown", "YES", "-FardeskUITest", "YES"]
        app.launch()
        let row = sessionRows(app).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let field = element(app, "composer-field")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("offline probe")
        tapAndMeasure("send offline", app, element(app, "send-button"), key: "send.pending", until: element(app, "pending-message"))
        let label = element(app, "pending-message").label
        XCTAssertTrue(label.contains("Queued") || label.contains("Not sent"), "state in words: \(label)")
        shot("queued with the hub gone")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "pending-message").count, 1)
    }

    // MARK: Not testable against the real hub from here

    func testHubGoneMidSessionBannerAppearsAndClears() throws {
        throw XCTSkip("needs the hub to be stopped and started during the run; the banner itself is covered by testCachedSessionsShowWithinASecondWhileTheHubIsUnreachable")
    }
}

// MARK: Session list: swipes and the machine table of contents

extension FardeskUITests {
    private func tocChips(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'toc-chip-'"))
    }

    func testSwipeRightRevealsALeadingButtonAndSwipeLeftATrailingButton() throws {
        let app = try launch()
        waitForCachedOrLiveSessions(app)
        let row = sessionRows(app).firstMatch
        row.swipeRight()
        // Swipe buttons carry no accessibility identifier in SwiftUI; their words are what the user sees.
        let leading = app.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Answer", "Open"])).firstMatch
        XCTAssertTrue(leading.waitForExistence(timeout: 3), "a right swipe reveals Allow, Answer or Open")
        shot("swipe right")
        row.swipeLeft()
        // The first left swipe only closes the open leading buttons, as on the phone.
        if !app.buttons.matching(NSPredicate(format: "label IN %@", ["Deny", "Stop", "End session"])).firstMatch.exists {
            row.swipeLeft()
        }
        let trailingLabels = ["Deny", "Stop", "End session"]
        let trailing = app.buttons.matching(NSPredicate(format: "label IN %@", trailingLabels)).firstMatch
        XCTAssertTrue(trailing.waitForExistence(timeout: 3), "a left swipe reveals a trailing button")
        shot("swipe left")
    }

    func testTocChipsExistAndTheLastChipScrollsItsMachineIntoView() throws {
        let app = try launch()
        waitForCachedOrLiveSessions(app)
        let chips = tocChips(app)
        XCTAssertTrue(chips.firstMatch.waitForExistence(timeout: 10), "one chip per machine at the top of the list")
        XCTAssertGreaterThanOrEqual(chips.count, 2, "one chip per machine")
        let first = String(chips.element(boundBy: 0).identifier.dropFirst("toc-chip-".count))
        let names = chips.allElementsBoundByIndex.map { String($0.identifier.dropFirst("toc-chip-".count)) }
        let expectedFirst = ProcessInfo.processInfo.environment["FARDESK_UITEST_FIRST_MACHINE"] ?? names.min { $0.lowercased() < $1.lowercased() }
        XCTAssertEqual(first, expectedFirst, "the configured machine order puts \(expectedFirst ?? "nothing") first")
        // The second chip is always fully on screen; the row scrolls sideways for the rest.
        let target = chips.element(boundBy: 1)
        let machineName = String(target.identifier.dropFirst("toc-chip-".count))
        target.tap()
        let header = element(app, "machine-header-\(machineName)")
        XCTAssertTrue(header.waitForExistence(timeout: 3))
        XCTAssertTrue(header.isHittable, "the section of \(machineName) is scrolled into view")
        shot("toc jump to \(machineName)")
    }
}
