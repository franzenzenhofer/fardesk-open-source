import Foundation

/// Contract name `FolderSearch`: folders matching a name query, recently used ones marked.
public struct FolderSearch: Codable, Sendable, Hashable {
    public struct Folder: Codable, Sendable, Hashable {
        public let path: String
        public let recent: Bool
    }

    public let folders: [Folder]
}
