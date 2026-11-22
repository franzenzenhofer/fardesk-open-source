import FardeskModels
import Testing

@testable import FardeskStore

struct SessionRowGlyphTests {
    @Test func everyStatusHasItsMockupGlyph() {
        #expect(SessionRowGlyph(status: .waiting) == .init(status: .waiting))
        #expect(SessionRowGlyph(status: .waiting).symbolName == "exclamationmark.circle.fill")
        #expect(SessionRowGlyph(status: .waiting).tint == .needsYou)
        #expect(SessionRowGlyph(status: .working).tint == .ok)
        #expect(SessionRowGlyph(status: .working).symbolName == "ellipsis.circle.fill")
        #expect(SessionRowGlyph(status: .working).pulses)
        #expect(SessionRowGlyph(status: .idle).symbolName == "arrowshape.turn.up.left.circle")
        #expect(SessionRowGlyph(status: .idle).tint == .ready)
        #expect(SessionRowGlyph(status: .ended).symbolName == "stop.circle.fill")
        #expect(SessionRowGlyph(status: .waiting, waitingFor: .terminal).symbolName == "laptopcomputer")
        for status in [SessionStatus.working, .waiting, .idle, .ended] {
            let symbol = SessionRowGlyph(status: status).symbolName
            #expect(!symbol.contains("pause") && !symbol.contains("checkmark"), "no pause sign, no check mark: \(symbol)")
        }
        #expect(SessionRowGlyph(status: .ended).tint == .inactive)
        #expect(!SessionRowGlyph(status: .idle).pulses)
    }

    @Test func needsYouTextAppearsOnlyWhenSomethingWaits() {
        #expect(NeedsYouLabel.text(count: 0) == nil)
        #expect(NeedsYouLabel.text(count: 1) == "1 needs you")
        #expect(NeedsYouLabel.text(count: 3) == "3 needs you")
    }
}
