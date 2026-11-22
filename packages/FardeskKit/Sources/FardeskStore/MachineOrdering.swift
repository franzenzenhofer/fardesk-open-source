import FardeskModels

/// The machine order of the session list: the names the owner listed first, in his order, then every other machine by
/// name (a stranger with no list gets the alphabetical order).
public enum MachineOrdering {
    public static func sorted(_ machines: [MachineState], preferred: [String] = []) -> [MachineState] {
        let ranks = Dictionary(preferred.enumerated().map { ($1.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
        return machines.sorted { precedes($0, $1, ranks: ranks) }
    }

    static func precedes(_ lhs: MachineState, _ rhs: MachineState, ranks: [String: Int]) -> Bool {
        let (leftName, rightName) = (lhs.endpoint.name.lowercased(), rhs.endpoint.name.lowercased())
        let (left, right) = (ranks[leftName] ?? ranks.count, ranks[rightName] ?? ranks.count)
        if left != right { return left < right }
        if leftName != rightName { return leftName < rightName }
        return lhs.id.uuidString < rhs.id.uuidString
    }
}
