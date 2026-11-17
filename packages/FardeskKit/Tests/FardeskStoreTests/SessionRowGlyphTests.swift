import FardeskModels
import Testing

@testable import FardeskStore

struct SessionRowGlyphTests {
    @Test func everyStatusHasItsMockupGlyph() {
        #expect(SessionRowGlyph(status: .waiting) == .init(status: .waiting))
        #expect(SessionRowGlyph(status: .waiting).symbolName == "exclamationmark.circle.fill")
        #expect(SessionRowGlyph(status: .waiting).tint == .needsYou)
        #expect(SessionRowGlyph(status: .working).tint == .ok)
        #expect(SessionRowGlyph(status: .working).symbolName == "play.circle.fill")
        #expect(SessionRowGlyph(status: .working).pulses)
        #expect(SessionRowGlyph(status: .idle).symbolName == "pause.circle.fill")
        #expect(SessionRowGlyph(status: .ended).symbolName == "checkmark.circle")
        #expect(SessionRowGlyph(status: .ended).tint == .inactive)
        #expect(!SessionRowGlyph(status: .idle).pulses)
    }

    @Test func needsYouTextAppearsOnlyWhenSomethingWaits() {
        #expect(NeedsYouLabel.text(count: 0) == nil)
        #expect(NeedsYouLabel.text(count: 1) == "1 needs you")
        #expect(NeedsYouLabel.text(count: 3) == "3 needs you")
    }
}
