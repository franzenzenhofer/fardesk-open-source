import FardeskStore
import Testing

struct VoiceRecordingTests {
    @Test func flowStartsOnceAndEndsOnce() {
        var flow = VoiceComposerFlow()
        let early = flow.finish(.send)
        #expect(early == nil)
        let started = flow.start()
        #expect(started)
        let again = flow.start()
        #expect(!again)
        #expect(flow.isRecording)
        let sent = flow.finish(.send)
        #expect(sent == .sendNow)
        #expect(!flow.isRecording)
        let late = flow.finish(.cancel)
        #expect(late == nil)
    }

    @Test func eachFinishMapsToItsOutcome() {
        for (finish, outcome) in [(VoiceFinish.send, VoiceOutcome.sendNow), (.edit, .moveToField), (.cancel, .discard)] {
            var flow = VoiceComposerFlow()
            flow.start()
            let result = flow.finish(finish)
            #expect(result == outcome)
        }
    }

    @Test func elapsedLabelFormats() {
        #expect(ElapsedLabel.text(seconds: -3) == "0:00")
        #expect(ElapsedLabel.text(seconds: 7.9) == "0:07")
        #expect(ElapsedLabel.text(seconds: 723) == "12:03")
        #expect(ElapsedLabel.text(seconds: 3729) == "1:02:09")
    }

    @Test func audioLevelIsClampedAndMonotonic() {
        #expect(AudioLevel.normalized(rms: 0) == 0)
        #expect(AudioLevel.normalized(rms: 0.001) == 0)
        #expect(AudioLevel.normalized(rms: 1) == 1)
        #expect(AudioLevel.normalized(rms: 4) == 1)
        let quiet = AudioLevel.normalized(rms: 0.01)
        let loud = AudioLevel.normalized(rms: 0.1)
        #expect(quiet > 0 && quiet < loud && loud < 1)
        #expect(abs(AudioLevel.normalized(rms: 0.0316227766) - 0.4) < 0.001)
    }

    @Test func imagesAreDownscaledButNeverUpscaled() {
        #expect(ComposerImageSizing.fittedSize(width: 4000, height: 3000) == (2048, 1536))
        #expect(ComposerImageSizing.fittedSize(width: 3000, height: 4000) == (1536, 2048))
        #expect(ComposerImageSizing.fittedSize(width: 800, height: 600) == (800, 600))
        #expect(ComposerImageSizing.fittedSize(width: 2048, height: 100) == (2048, 100))
        #expect(ComposerImageSizing.fittedSize(width: 10000, height: 1) == (2048, 1))
        #expect(ComposerImageSizing.fittedSize(width: 0, height: 10) == (0, 0))
    }

    @Test func onlyPNGSourcesStayPNG() {
        #expect(ComposerImageSizing.keepsPNG(sourceTypeIdentifier: "public.png"))
        #expect(!ComposerImageSizing.keepsPNG(sourceTypeIdentifier: "public.heic"))
        #expect(!ComposerImageSizing.keepsPNG(sourceTypeIdentifier: nil))
    }

    @Test func sendNeedsTextOrPictures() {
        #expect(!ComposerSendRule.canSend(text: "  \n", imageCount: 0))
        #expect(ComposerSendRule.canSend(text: "hi", imageCount: 0))
        #expect(ComposerSendRule.canSend(text: "", imageCount: 1))
    }

    @Test func sendAcceptsOnlyFiles() {
        #expect(ComposerSendRule.canSend(text: "", imageCount: 0, fileCount: 1))
        #expect(!ComposerSendRule.canSend(text: " ", imageCount: 0, fileCount: 0))
    }

    @Test func fileSizeLimitIsTwentyMegabytes() {
        #expect(ComposerFileRules.fits(byteCount: 20_000_000))
        #expect(!ComposerFileRules.fits(byteCount: 20_000_001))
        #expect(ComposerFileRules.tooLargeMessage(name: "a.pdf", byteCount: 25_300_000) == "a.pdf is 25.3 MB; the limit is 20 MB.")
    }

    @Test func fileMediaTypeFallsBackToBinary() {
        #expect(ComposerFileRules.mediaType(preferred: "application/pdf") == "application/pdf")
        #expect(ComposerFileRules.mediaType(preferred: nil) == "application/octet-stream")
        #expect(ComposerFileRules.mediaType(preferred: " ") == "application/octet-stream")
    }

    @Test func attachmentSlotsCountPicturesAndFiles() {
        #expect(ComposerFileRules.remainingSlots(images: 4, files: 3) == 3)
        #expect(ComposerFileRules.remainingSlots(images: 8, files: 5) == 0)
    }
}
