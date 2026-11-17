import Foundation

/// A file the daemon named at the end of a user message: `Attached image: /abs/path.png`.
public struct AttachedFile: Equatable, Sendable, Identifiable {
    public enum Kind: String, Equatable, Sendable {
        case image, audio, file
    }

    public let kind: Kind
    public let path: String

    public var id: String { path }

    /// The name shown on a chip: the stored name without its time stamp prefix.
    public var displayName: String {
        let name = (path as NSString).lastPathComponent
        guard let dash = name.firstIndex(of: "-"), name[..<dash].hasSuffix("Z"), name[..<dash].count == 19 else { return name }
        return String(name[name.index(after: dash)...])
    }

    public init(kind: Kind, path: String) {
        self.kind = kind
        self.path = path
    }
}

/// A user message split into the words the person wrote and the files the daemon appended to them.
public struct AttachedFiles: Equatable, Sendable {
    private static let prefix = "Attached "

    public let words: String
    public let files: [AttachedFile]

    public init(parsing text: String) {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var found: [AttachedFile] = []
        while let last = lines.last, let file = Self.file(in: last) {
            found.append(file)
            lines.removeLast()
        }
        files = found.reversed()
        words = found.isEmpty ? text : lines.joined(separator: "\n")
    }

    private static func file(in line: String) -> AttachedFile? {
        guard line.hasPrefix(prefix), let colon = line.firstIndex(of: ":") else { return nil }
        let label = line[line.index(line.startIndex, offsetBy: prefix.count)..<colon]
        let path = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        guard let kind = AttachedFile.Kind(rawValue: String(label)), path.hasPrefix("/") else { return nil }
        return AttachedFile(kind: kind, path: path)
    }
}
