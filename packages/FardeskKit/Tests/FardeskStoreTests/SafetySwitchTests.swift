import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

struct SafetySwitchTests {
    private let open = OnlineMachine(id: UUID(), name: "Open", models: [])
    private let closed = OnlineMachine(id: UUID(), name: "Closed", models: [], allowBypass: false, coordinatorEnabled: false)

    @Test func theSheetOffersBypassOnlyWhenTheMachineAllowsIt() {
        #expect(NewSessionPresentation.permissionModes(for: open).contains(.bypassPermissions))
        #expect(NewSessionPresentation.permissionModes(for: nil).contains(.bypassPermissions))
        let modes = NewSessionPresentation.permissionModes(for: closed)
        #expect(!modes.contains(.bypassPermissions))
        #expect(modes.contains(.default))
    }

    @Test func aDraftInBypassFallsBackToAskOnAMachineThatRefusesIt() {
        var draft = NewSessionDraft()
        #expect(draft.permissionMode == .bypassPermissions)
        draft.keepModeAllowed(on: open)
        #expect(draft.permissionMode == .bypassPermissions)
        draft.keepModeAllowed(on: closed)
        #expect(draft.permissionMode == .default)
        draft.permissionMode = .plan
        draft.keepModeAllowed(on: closed)
        #expect(draft.permissionMode == .plan)
    }

    @Test func aMachineAnswerWithTheFlagsOffKeepsThem() throws {
        let machine = try Fixtures.decode(Machine.self, "Machine", "linuxWithoutClaude")
        #expect(!machine.allowBypass)
        #expect(!machine.coordinatorEnabled)
    }

    @Test func theOffTextNamesTheMachineAndTheConfigKey() {
        let text = CoordinatorPresentation.offText(machineName: "Studio")
        #expect(text.contains("Studio"))
        #expect(text.contains("coordinator.enabled"))
    }
}
