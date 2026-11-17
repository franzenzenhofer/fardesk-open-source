import Foundation

public struct ActivityPage: Codable, Sendable, Hashable {
    public let items: [Activity]
    public let nextBefore: String?
}

extension ActivityPage {
    private enum CodingKeys: String, CodingKey {
        case items, nextBefore
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([Activity].self, forKey: .items)
        nextBefore = try c.decode(String?.self, forKey: .nextBefore)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(items, forKey: .items)
        try c.encode(nextBefore, forKey: .nextBefore)
    }
}

public struct DetailLine: Codable, Sendable, Hashable {
    public let number: Int?
    public let sign: DiffSign
    public let text: String
}

extension DetailLine {
    private enum CodingKeys: String, CodingKey {
        case number, sign, text
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        number = try c.decode(Int?.self, forKey: .number)
        sign = try c.decode(DiffSign.self, forKey: .sign)
        text = try c.decode(String.self, forKey: .text)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(number, forKey: .number)
        try c.encode(sign, forKey: .sign)
        try c.encode(text, forKey: .text)
    }
}

public struct DetailSection: Codable, Sendable, Hashable {
    public let title: String
    public let subtitle: String
    public let added: Int
    public let removed: Int
    public let lines: [DetailLine]
}

public struct ActivityDetail: Codable, Sendable, Hashable {
    public let activityId: String
    public let kind: DetailKind
    public let truncated: Bool
    public let sections: [DetailSection]
}

public struct RecentFolder: Codable, Sendable, Hashable {
    public let path: String
    public let lastUsedAt: Date
}

public struct RecentFolders: Codable, Sendable, Hashable {
    public let folders: [RecentFolder]
}
