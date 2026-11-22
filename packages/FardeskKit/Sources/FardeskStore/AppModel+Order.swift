import Foundation

extension AppModel {
    /// Reads the order the user chose. A corrupt file is said aloud and the list falls back to alphabetical: the
    /// order is a preference, it never keeps the app from starting.
    func loadMachineOrder() {
        guard let file = configuration.machineOrderFile else { return }
        do {
            state = AppState(machineOrder: try file.load())
        } catch {
            raise("Fardesk: the saved machine order is unreadable, machines are shown alphabetically: \(ErrorText.detail(error))", area: "read the machine order", error: error)
        }
    }

    /// The user dragged machines in the settings list: the new order is shown at once and kept on this device.
    /// `destination` counts positions in the list before the move (the SwiftUI `onMove` convention).
    public func moveMachines(from source: IndexSet, to destination: Int) {
        let names = state.machines.map(\.endpoint.name)
        let moved = source.map { names[$0] }
        let before = names.indices.filter { $0 < destination && !source.contains($0) }.map { names[$0] }
        let after = names.indices.filter { $0 >= destination && !source.contains($0) }.map { names[$0] }
        let reordered = before + moved + after
        state.setMachineOrder(reordered)
        guard let file = configuration.machineOrderFile else { return }
        do {
            try file.save(reordered)
        } catch {
            raise("Fardesk: could not save the machine order: \(ErrorText.detail(error))", area: "save the machine order", error: error)
        }
    }
}
