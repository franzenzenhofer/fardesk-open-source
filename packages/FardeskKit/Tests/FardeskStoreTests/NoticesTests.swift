import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// One notice system: a notice lives in its own place (a session's feed or the list) and never follows the user.
@MainActor
struct NoticesTests {
    private let ref = SessionRef(machineID: UUID(), sessionID: "s1")
    private let other = SessionRef(machineID: UUID(), sessionID: "s2")

    @Test func aSessionNoticeShowsOnlyInItsSession() async throws {
        let model = AppModel(configuration: try StoreSandbox().configuration())
        model.showNotice(.running("end the session", machine: "Linux"), in: .session(ref))
        #expect(model.notices[.session(ref)]?.text == "End the session on Linux...")
        #expect(model.notices[.session(other)] == nil)
        #expect(model.notices[.list] == nil, "nothing on the list")
    }

    @Test func leavingASessionClearsWhatWasSaidThereButNotWhatStillRuns() async throws {
        let model = AppModel(configuration: try StoreSandbox().configuration())
        model.showNotice(.failed("stop the session", machine: "Linux", reason: "gone"), in: .session(ref))
        let step = model.beginStep(ref, "Loading...")
        model.failStep(ref, step, reason: "no answer")
        #expect(model.failureSignal == 1)
        model.leaveSession(ref)
        #expect(model.notices[.session(ref)] == nil, "a failure does not wait on a screen the user left")
        #expect(model.stepLogs[ref] == nil, "a failed step log does not stay over the feed forever")
        model.showNotice(.running("end the session", machine: "Linux"), in: .session(other))
        model.beginStep(other, "Ending...")
        model.leaveSession(other)
        #expect(model.notices[.session(other)] != nil && model.stepLogs[other]?.isRunning == true, "running work stays")
    }

    @Test func aDoneNoticeGoesAwayByItselfAFailureStaysUntilDismissed() async throws {
        let model = AppModel(configuration: try StoreSandbox().configuration())
        model.showNotice(.succeeded("stop the session", machine: "Linux"), in: .session(ref))
        model.showNotice(.failed("stop the session", machine: "Linux", reason: "gone"), in: .list)
        try await Task.sleep(for: AppModel.noticeLinger + .milliseconds(300))
        #expect(model.notices[.session(ref)] == nil)
        #expect(model.notices[.list]?.state == .failed)
        model.dismissNotice(in: .list)
        #expect(model.notices[.list] == nil)
    }

    @Test func aLoadThatWorksLaterRemovesTheOldLoadFailureAndACancelledLoadSaysNothing() async throws {
        let model = AppModel(configuration: try StoreSandbox().configuration())
        let failed = model.beginStep(ref, "\(AppModel.loadingStepPrefix) 50 rows from Linux...")
        model.failStep(ref, failed, reason: "the machine did not answer")
        let resume = model.beginStep(ref, "Resuming the session on Linux...")
        model.failStep(ref, resume, reason: "refused")
        model.stepLogs[ref]?.dropFailures(matching: AppModel.loadingStepPrefix)
        #expect(model.stepLogs[ref]?.steps.map(\.text) == ["Resuming the session on Linux..."], "only the stale load failure goes")
        let cancelled = model.beginStep(other, "\(AppModel.loadingStepPrefix) 50 rows from Linux...")
        model.dropStep(other, cancelled)
        #expect(model.stepLogs[other] == nil, "a cancelled open leaves no line")
    }

    @Test func tellSpeaksOnTheList() async throws {
        let model = AppModel(configuration: try StoreSandbox().configuration())
        model.tell("No machine yet", failed: false)
        #expect(model.notices[.list]?.state == .info)
    }
}
