import FardeskStore
import Foundation
import Testing

struct NewSessionPresentationTests {
    @Test func shortNamesDropTheMachineFamily() {
        #expect(NewSessionPresentation.shortName("Mac mini Pro") == "Pro")
        #expect(NewSessionPresentation.shortName("Mac mini M2") == "M2")
        #expect(NewSessionPresentation.shortName("Linux box") == "Linux")
        #expect(NewSessionPresentation.shortName("Linux") == "Linux")
        #expect(NewSessionPresentation.shortName("MacBook") == "MacBook")
    }

    @Test func collidingShortNamesFallBackToFullNames() {
        let a = (id: UUID(), name: "Mac mini Pro")
        let b = (id: UUID(), name: "Mac Studio Pro")
        let choices = NewSessionPresentation.choices([a, b])
        #expect(choices.map(\.shortName) == ["Mac mini Pro", "Mac Studio Pro"])
        let distinct = NewSessionPresentation.choices([a, (id: UUID(), name: "Linux")])
        #expect(distinct.map(\.shortName) == ["Pro", "Linux"])
        #expect(distinct.map(\.fullName) == ["Mac mini Pro", "Linux"])
    }

    @Test func otherFolderOverridesTheRecentPick() {
        var draft = NewSessionDraft()
        draft.pick(folder: "/home/dev/dev/crawler")
        #expect(draft.cwd == "/home/dev/dev/crawler")
        draft.showsOtherFolder = true
        draft.customFolder = "/srv/x"
        #expect(draft.cwd == "/srv/x")
        draft.pick(folder: "/home/dev/dev/api")
        #expect(draft.cwd == "/home/dev/dev/api")
    }

    @Test func startNeedsMachineFolderAndPrompt() {
        var draft = NewSessionDraft()
        draft.pick(folder: "/a")
        draft.prompt = "  \n"
        draft.machineID = UUID()
        #expect(!draft.canStart)
        draft.prompt = "Do it"
        #expect(draft.canStart)
    }

    @Test func footerNamesTheMachine() {
        #expect(NewSessionPresentation.footer(machineName: "Linux") == "Runs on Linux")
        #expect(NewSessionPresentation.footer(machineName: nil) == nil)
    }
}
