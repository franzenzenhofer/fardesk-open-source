import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

@MainActor
struct DetailAndRequestPresentationTests {
    @Test func diffDetailHasATitleAndPlainText() throws {
        let diff = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "diff")
        #expect(diff.screenTitle == "Changes")
        let text = diff.plainText
        let first = try #require(diff.sections.first)
        #expect(text.hasPrefix("\(first.title) (+\(first.added) -\(first.removed))"))
        #expect(text.contains("\n"))
    }

    @Test func outputDetailIsCalledOutput() throws {
        let output = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "output")
        #expect(output.screenTitle == "Output")
        let empty = try Fixtures.decode(ActivityDetail.self, "ActivityDetail", "outputNoSections")
        #expect(empty.plainText.isEmpty)
    }

    @Test func resolvedRequestsAreOneLine() throws {
        guard case .permission(let allowed) = try Fixtures.activity("permissionAllowed"),
              case .permission(let denied) = try Fixtures.activity("permissionDeniedDestructive"),
              case .question(let answered) = try Fixtures.activity("questionAnswered")
        else { throw FixtureShapeError() }
        #expect(ResolvedRequestPresentation(permission: allowed).symbolName == FardeskSymbol.permissionAllowed)
        #expect(ResolvedRequestPresentation(permission: denied).symbolName == FardeskSymbol.permissionDenied)
        #expect(ResolvedRequestPresentation(permission: denied).text.hasSuffix("(denied)"))
        #expect(ResolvedRequestPresentation(question: answered).text.hasSuffix("(answered)"))
        #expect(ResolvedRequestPresentation(question: answered).symbolName == FardeskSymbol.question)
    }

    @Test func headerSubtitleJoinsMachineFolderAndStatus() throws {
        let session = try Fixtures.session("working")
        let presentation = SessionPresentation(session: session, now: Date())
        let subtitle = presentation.headerSubtitle(machineName: "Mac")
        #expect(subtitle == "Mac \u{00B7} \(presentation.folderLabel) \u{00B7} \(presentation.statusLabel)")
    }

    @Test func dismissErrorClearsTheError() async throws {
        try await StoreSandbox.with { sandbox in
            let model = AppModel(configuration: sandbox.configuration())
            await model.pair(link: "fardesk://pair?d=")
            model.dismissError()
            #expect(model.lastError == nil)
        }
    }
}

struct FixtureShapeError: Error {}
