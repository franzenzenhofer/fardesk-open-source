/// What a tap on "Load earlier messages" brought: the rows now above the row that was first before the tap.
/// The chat fades exactly those in and marks where they end, so the user sees that something arrived.
public struct EarlierRows: Equatable, Sendable {
    public let ids: Set<String>
    /// The row that was first before the tap: the "N earlier messages loaded" line sits right above it.
    public let boundaryID: String

    public var count: Int { ids.count }

    /// Nil when nothing new arrived above the old first row.
    public init?(blockIDs: [String], previousFirstID: String?) {
        guard let previousFirstID, let index = blockIDs.firstIndex(of: previousFirstID), index > 0 else { return nil }
        ids = Set(blockIDs[..<index])
        boundaryID = previousFirstID
    }

    public var label: String { count == 1 ? "1 earlier message loaded" : "\(count) earlier messages loaded" }
}
