import FardeskDemo
import FardeskModels
@testable import FardeskStore
import Foundation
import Testing

@MainActor
struct DemoChatImageTests {
    @Test func theDemoRefusesToSetOrClearAChatImage() async throws {
        let demo = AppModel.makeDemo(world: try DemoWorld(replyDelay: .milliseconds(20)))
        defer { demo.endDemo() }
        await demo.start()
        let machine = try #require(demo.state.machines.first)
        let ref = SessionRef(machineID: machine.id, sessionID: try #require(machine.sessions.first).id)
        let set = await demo.setImage(Data([0xFF, 0xD8, 0xFF]), mediaType: "image/jpeg", for: ref)
        let cleared = await demo.clearImage(ref)
        #expect(!set && !cleared)
    }
}
