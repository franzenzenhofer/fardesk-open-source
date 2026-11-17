/// Outcome of matching a user-typed name against a list.
public enum PrefixMatch<Item: Sendable>: Sendable {
    case none
    case unique(Item)
    case ambiguous([Item])
}

extension PrefixMatch: Equatable where Item: Equatable {}

/// Case-insensitive matching used by the CLI: an exact name wins, otherwise a unique prefix.
public enum UniquePrefix {
    public static func resolve<Item: Sendable>(
        _ query: String,
        in items: [Item],
        name: (Item) -> String
    ) -> PrefixMatch<Item> {
        let needle = query.lowercased()
        guard !needle.isEmpty else { return .none }
        let exact = items.filter { name($0).lowercased() == needle }
        if !exact.isEmpty { return classify(exact) }
        return classify(items.filter { name($0).lowercased().hasPrefix(needle) })
    }

    private static func classify<Item: Sendable>(_ matches: [Item]) -> PrefixMatch<Item> {
        switch matches.count {
        case 0: .none
        case 1: .unique(matches[0])
        default: .ambiguous(matches)
        }
    }
}
