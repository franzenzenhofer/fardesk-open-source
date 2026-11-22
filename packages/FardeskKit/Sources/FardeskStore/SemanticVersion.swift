/// A release number like `4.2.0`, compared number by number (`4.10.0` is newer than `4.9.0`). A suffix after `-` or
/// `+` (a pre-release or build tag) is ignored.
public struct SemanticVersion: Comparable, Hashable, Sendable {
    public let numbers: [Int]

    /// Nil unless the text starts with dot-separated whole numbers.
    public init?(_ text: String) {
        let core = text.split(whereSeparator: { $0 == "-" || $0 == "+" }).first.map(String.init) ?? ""
        let parts = core.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        guard !parts.isEmpty, !parts.contains(nil) else { return nil }
        numbers = parts.compactMap { $0 }
    }

    public static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        let count = max(lhs.numbers.count, rhs.numbers.count)
        for index in 0..<count {
            let (left, right) = (lhs.number(at: index), rhs.number(at: index))
            if left != right { return left < right }
        }
        return false
    }

    public static func == (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        !(lhs < rhs) && !(rhs < lhs)
    }

    public func hash(into hasher: inout Hasher) {
        var trimmed = numbers
        while trimmed.last == 0 { trimmed.removeLast() }
        hasher.combine(trimmed)
    }

    private func number(at index: Int) -> Int {
        index < numbers.count ? numbers[index] : 0
    }
}
