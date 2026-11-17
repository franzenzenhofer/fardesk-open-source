import FardeskFixtures
import FardeskModels
import FardeskStore
import FardeskTestDaemon
@testable import FardeskCLICore
import Foundation
import Testing

struct ColdReplyTests {
    @Test func theWarningNamesTheWayOn() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let format = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        let session = try Fixtures.session("idleResume", overriding: [
            "contextTokens": 426_323, "cacheExpiresAt": format.format(now.addingTimeInterval(-60)),
            "updatedAt": format.format(now.addingTimeInterval(-3 * 3_600)),
        ])
        let text = ReplyCommand.coldWarning(session, now: now)
        #expect(text.hasPrefix("Resume this conversation? Inactive for 3 h and 426k tokens long. Continuing re-reads all of it."))
        #expect(text.contains("--resume full") && text.contains("--resume summary") && text.contains("--resume new"))
    }

    @Test func resumeOptionsMapToTheChoices() {
        #expect(ResumeOption.allCases.map(\.choice) == [.resume, .summary, .startNew])
        #expect(ResumeOption(rawValue: "full") == .full)
    }

    @Test func anUnknownResumeValueIsAUsageError() async throws {
        let cli = try CLIHarness()
        #expect(await cli.run(["reply", "abc", "hi", "--resume", "later"]).status == 64)
    }

    @Test func compactAsksTheDaemonAndNeverCrashes() async throws {
        try await CLIHarness.withPairedDaemon { cli, _ in
            let result = await cli.run(["compact", shortID(SeedSession.endedSessionID)])
            #expect(result.status == 0 || result.status == 1, "an answer or an error with a message, never a usage error")
            if result.status == 1 { #expect(result.errText.hasPrefix("error: ")) }
        }
    }
}
