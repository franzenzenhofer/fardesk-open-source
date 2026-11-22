import FardeskDemo
import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

/// Tickets #99 (row swipes) and #104 (what is disabled in the demo).
@MainActor
struct DemoLimitsAndSwipeTests {
    @Test func oneSwipePerSidePinAndEndOnly() throws {
        for name in ["working", "waitingPermission", "waitingQuestion", "idleResume"] {
            let session = try Fixtures.session(name)
            let plan = SessionSwipePlan(session: session)
            #expect(plan.leading == [session.label.pinned ? .unpin : .pin], "\(name): left to right is Pin (or Unpin) only")
            #expect(plan.trailing == [.end], "\(name): right to left is End this chat only")
        }
        let pinned = try Fixtures.session("working", overriding: ["label": ["name": NSNull(), "color": NSNull(), "pinned": true] as [String: any Sendable]])
        #expect(SessionSwipePlan(session: pinned).leading == [.unpin])
        let ended = SessionSwipePlan(session: try Fixtures.session("endedTakeover"))
        #expect(ended.leading.count == 1 && ended.trailing == [.hide], "a stopped chat is removed from the list, not ended")
    }

    @Test func everySwipeFillCarriesItsWhiteLabelAtFourPointFiveToOne() {
        for fill in SwipeFill.all {
            #expect(fill.contrast >= 4.5, "fill \(String(fill.hex, radix: 16)) has contrast \(fill.contrast)")
        }
    }

    @Test func theDemoIsReadOnly() throws {
        let demo = AppModel.makeDemo(world: try DemoWorld(replyDelay: .milliseconds(20)))
        defer { demo.endDemo() }
        for feature in AppFeature.allCases {
            #expect(demo.isAvailable(feature) == !AppFeature.unavailableInDemo.contains(feature))
        }
        #expect(!demo.isAvailable(.coordinator) && !demo.isAvailable(.logOut) && !demo.isAvailable(.addMachine))
        #expect(!demo.isAvailable(.notificationSettings) && !demo.isAvailable(.liveActivityPin))
        #expect(!demo.isAvailable(.sessionActions) && !demo.isAvailable(.composer) && !demo.isAvailable(.newSession))
    }

    @Test func aRealModelHasEveryFeature() throws {
        let model = AppModel.makeDemo(world: try DemoWorld(replyDelay: .milliseconds(20)))
        defer { model.endDemo() }
        model.demo = nil
        for feature in AppFeature.allCases { #expect(model.isAvailable(feature)) }
    }
}
