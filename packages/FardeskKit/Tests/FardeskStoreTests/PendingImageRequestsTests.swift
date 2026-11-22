import FardeskModels
import FardeskStore
import Foundation
import Testing

struct PendingImageRequestsTests {
    private let ref = SessionRef(machineID: UUID(), sessionID: "s1")
    private let start = Date(timeIntervalSince1970: 1_000_000)

    @Test func aChatIsPendingFromTheTapUntilItsImageChanges() {
        var pending = PendingImageRequests()
        #expect(!pending.isPending(ref, currentImage: nil, at: start))
        pending.asked(ref, currentImage: nil, at: start)
        #expect(pending.isPending(ref, currentImage: nil, at: start.addingTimeInterval(30)))
        #expect(!pending.isPending(ref, currentImage: "newhash", at: start.addingTimeInterval(31)))
    }

    @Test func aChatThatAlreadyHadAnImageWaitsForADifferentOne() {
        var pending = PendingImageRequests()
        pending.asked(ref, currentImage: "old", at: start)
        #expect(pending.isPending(ref, currentImage: "old", at: start.addingTimeInterval(5)))
        #expect(!pending.isPending(ref, currentImage: "new", at: start.addingTimeInterval(5)))
        #expect(!pending.isPending(ref, currentImage: nil, at: start.addingTimeInterval(5)))
    }

    @Test func theButtonComesBackWhenTheJobDiedQuietly() {
        var pending = PendingImageRequests()
        pending.asked(ref, currentImage: nil, at: start)
        let justBefore = start.addingTimeInterval(PendingImageRequests.patience - 1)
        #expect(pending.isPending(ref, currentImage: nil, at: justBefore))
        #expect(!pending.isPending(ref, currentImage: nil, at: start.addingTimeInterval(PendingImageRequests.patience)))
    }

    @Test func aRefusedJobIsForgottenAndOtherChatsAreNotTouched() {
        var pending = PendingImageRequests()
        let other = SessionRef(machineID: ref.machineID, sessionID: "s2")
        pending.asked(ref, currentImage: nil, at: start)
        #expect(!pending.isPending(other, currentImage: nil, at: start))
        pending.forget(ref)
        #expect(!pending.isPending(ref, currentImage: nil, at: start))
    }
}
