import Foundation

/// The single place that defines how Fardesk wire JSON is encoded and decoded.
public enum FardeskJSON {
    private static let timestampStyle = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            return try timestampStyle.parse(text)
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(timestampStyle.format(date))
        }
        return encoder
    }
}
