@testable import FardeskStore
import Foundation
import Testing

struct CoordinatorPresentationTests {
    @Test func rowAndEmptyStateSayPlainlyWhatTheCoordinatorDoes() {
        #expect(CoordinatorPresentation.title == "Coordinator")
        #expect(CoordinatorPresentation.symbol == "point.3.connected.trianglepath.dotted")
        #expect(CoordinatorPresentation.suggestions.count == 4)
        #expect(CoordinatorPresentation.screenSubtitle(machine: "Mac Studio") == "Coordinator \u{00B7} Mac Studio")
    }

    @Test func newSessionPromptIsPrefixedAndBlankIsRejected() {
        #expect(CoordinatorPresentation.newSessionPrompt(describing: "  fix the tests \n")
            == "Start a new Claude session: fix the tests")
        #expect(CoordinatorPresentation.newSessionPrompt(describing: " \n ") == nil)
    }

    @Test func pendingCoordinatorRefIsRecognisedAndRealRefsAreNot() {
        let id = UUID()
        #expect(SessionRef.pendingCoordinator(on: id).isPendingCoordinator)
        #expect(SessionRef.pendingCoordinator(on: id).machineID == id)
        #expect(!SessionRef(machineID: id, sessionID: "abc").isPendingCoordinator)
    }
}
