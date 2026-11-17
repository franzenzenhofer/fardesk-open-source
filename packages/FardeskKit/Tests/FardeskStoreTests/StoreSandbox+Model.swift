import FardeskFixtures
import FardeskModels
@testable import FardeskStore
import Foundation

extension StoreSandbox {
    /// A started model with one machine ("Studio") that has received the "helloWithSessions" fixture.
    @MainActor
    func startedModelWithSessions() async throws -> (AppModel, MachineEndpoint) {
        let endpoint = Fixtures.endpoint("Studio")
        var list = MachineList()
        list.add(endpoint)
        try machinesFile.save(list)
        let model = AppModel(configuration: configuration())
        await model.start()
        model.apply(try Fixtures.event("helloWithSessions"), from: endpoint.id)
        return (model, endpoint)
    }
}
