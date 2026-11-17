import FardeskModels

/// Pages back through a session's activity with the daemon's `nextBefore` cursor.
enum ActivityPaging {
    /// Fetches the page before `cursor` (the newest page when nil). With `all`, keeps going back
    /// until the start of the session. Rows come back oldest first, as the feed prints them.
    static func rows(
        before cursor: String?,
        all: Bool,
        fetch: (String?) async throws -> ActivityPage
    ) async throws -> [Activity] {
        var rows: [Activity] = []
        var next = cursor
        repeat {
            let page = try await fetch(next)
            rows = page.items + rows
            guard all, let older = page.nextBefore else { break }
            guard older != next else { throw CLIError.usage("The daemon returned the same paging cursor twice (\(older)).") }
            next = older
        } while true
        return rows
    }
}
