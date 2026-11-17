import Foundation

extension TestDaemon {
    /// Appends a real user-prompt line (the format Claude Code writes) to a session's transcript.
    public func appendUserPrompt(_ text: String, toSession sessionID: String) throws {
        let line: [String: Any] = [
            "parentUuid": NSNull(),
            "isSidechain": false,
            "type": "user",
            "message": ["role": "user", "content": text],
            "uuid": UUID().uuidString.lowercased(),
            "timestamp": Date().formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)),
            "sessionId": sessionID,
            "cwd": "/Users/dev/dev",
            "version": "2.1.318",
            "userType": "external",
            "entrypoint": "cli",
        ]
        let data = try JSONSerialization.data(withJSONObject: line)
        try appendLine(String(decoding: data, as: UTF8.self), toSession: sessionID)
    }
}
