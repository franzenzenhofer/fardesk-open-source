import FardeskStore
import Testing

struct DictationStateTests {
    @Test func startsIdleWithAnEmptyField() {
        let state = DictationState()
        #expect(state.phase == .idle)
        #expect(!state.isListening)
        #expect(state.fieldText.isEmpty)
        #expect(state.errorMessage == nil)
    }

    @Test func volatileTextIsReplacedAndFinalTextIsKept() {
        var state = DictationState()
        state.start(appendingTo: "")
        #expect(state.isListening)
        state.hear("hel", isFinal: false)
        state.hear("hello", isFinal: false)
        #expect(state.fieldText == "hello")
        state.hear("hello there", isFinal: true)
        state.hear("how", isFinal: false)
        #expect(state.fieldText == "hello there how")
    }

    @Test func dictationAppendsToWhatWasTyped() {
        var state = DictationState()
        state.start(appendingTo: "Please run ")
        state.hear("the tests", isFinal: true)
        #expect(state.fieldText == "Please run the tests")
        state.stop()
        #expect(state.phase == .idle)
        #expect(state.fieldText == "Please run the tests")
        state.start(appendingTo: state.fieldText)
        state.hear("again", isFinal: true)
        #expect(state.fieldText == "Please run the tests again")
    }

    @Test func emptyHeardTextLeavesTheFieldAlone() {
        var state = DictationState()
        state.start(appendingTo: "keep")
        state.hear("   ", isFinal: true)
        #expect(state.fieldText == "keep")
    }

    @Test func resultsAfterStopAreIgnored() {
        var state = DictationState()
        state.start(appendingTo: "")
        state.hear("one", isFinal: true)
        state.stop()
        state.hear("late", isFinal: true)
        #expect(state.fieldText == "one")
    }

    @Test func failureKeepsTheHeardTextAndShowsTheError() {
        var state = DictationState()
        state.start(appendingTo: "")
        state.hear("partial", isFinal: false)
        state.fail("Microphone access is off.")
        #expect(state.phase == .failed("Microphone access is off."))
        #expect(state.errorMessage == "Microphone access is off.")
        #expect(state.fieldText == "partial")
        state.start(appendingTo: state.fieldText)
        #expect(state.errorMessage == nil)
    }

    @Test func settledAndChangingTextAreSeparate() {
        var state = DictationState()
        state.start(appendingTo: "Hi")
        state.hear("hello there", isFinal: true)
        state.hear("how are", isFinal: false)
        #expect(state.committedText == "Hi hello there")
        #expect(state.volatileText == "how are")
        #expect(state.fieldText == "Hi hello there how are")
    }
}
