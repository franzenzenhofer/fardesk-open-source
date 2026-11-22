import Foundation

/// A colour the user, or the daemon's automatic colour coding, marks a session with: `#RRGGBB`, upper case
/// (docs/design/SESSION-LABELS.md). Any such colour is valid; the 64 presets are in `LabelPalette`.
public struct LabelColor: Codable, Sendable, Hashable {
    public let hex: String

    /// Nil unless `hex` is exactly `#` and six upper-case hex digits, the form the daemon contract accepts.
    public init?(hex: String) {
        guard Self.isValid(hex) else { return nil }
        self.hex = hex
    }

    /// From 8-bit channels, e.g. what the system colour picker returns.
    public init(red: Int, green: Int, blue: Int) {
        let clamp = { (value: Int) in max(0, min(255, value)) }
        hex = String(format: "#%02X%02X%02X", clamp(red), clamp(green), clamp(blue))
    }

    public init(from decoder: any Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let color = LabelColor(hex: text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "not a #RRGGBB colour: \(text)"))
        }
        self = color
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(hex)
    }

    public var red: Int { channel(1) }
    public var green: Int { channel(3) }
    public var blue: Int { channel(5) }

    /// The preset this colour is, if it is one.
    public var preset: LabelPreset? { LabelPalette.presets.first { $0.color == self } }

    /// VoiceOver and menus: the preset's name, else the hex code.
    public var displayName: String { preset?.name ?? hex }

    private func channel(_ offset: Int) -> Int {
        let start = hex.index(hex.startIndex, offsetBy: offset)
        return Int(hex[start..<hex.index(start, offsetBy: 2)], radix: 16) ?? 0
    }

    private static func isValid(_ text: String) -> Bool {
        let digits = Array(text.utf8)
        guard digits.count == 7, digits[0] == UInt8(ascii: "#") else { return false }
        return digits.dropFirst().allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 70) }
    }
}

/// One of the 64 named presets.
public struct LabelPreset: Codable, Sendable, Hashable {
    public let name: String
    public let color: LabelColor
}
