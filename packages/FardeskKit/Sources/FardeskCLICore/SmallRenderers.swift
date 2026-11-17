import FardeskModels
import FardeskStore

/// `fardesk folders`: recent folders, newest first as the daemon sends them.
public enum FoldersRenderer {
    public static func render(_ folders: RecentFolders, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(folders)
        case .human: human(folders, options: options)
        }
    }

    private static func human(_ folders: RecentFolders, options: RenderOptions) -> String {
        guard !folders.folders.isEmpty else { return "No recent folders" }
        let rows = folders.folders.map {
            [$0.path, RelativeTimeFormat.short(from: $0.lastUsedAt, to: options.now)]
        }
        let widths = TextTable.widths(of: rows)
        return rows.map { TextTable.format($0, widths: widths) }.joined(separator: "\n")
    }
}

/// `fardesk pair`: confirms a paired machine. Never prints the token.
public enum PairingRenderer {
    private struct Confirmation: Encodable {
        let id: String
        let name: String
        let url: String
    }

    public static func render(_ endpoint: MachineEndpoint, options: RenderOptions) throws -> String {
        switch options.format {
        case .json:
            try JSONOutput.compact(
                Confirmation(id: endpoint.id.uuidString, name: endpoint.name, url: endpoint.url.absoluteString)
            )
        case .human:
            "Paired \(endpoint.name) at \(endpoint.url.absoluteString)"
        }
    }
}

/// `error: <message> (<code>)`, or the contract `ErrorResponse` JSON.
public enum ErrorRenderer {
    public static func render(_ response: ErrorResponse, options: RenderOptions) throws -> String {
        switch options.format {
        case .json: try JSONOutput.compact(response)
        case .human: "error: \(response.error.message) (\(response.error.code.rawValue))"
        }
    }
}
