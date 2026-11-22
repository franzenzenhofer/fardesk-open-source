import FardeskClient
import FardeskModels
import Foundation

/// The ways on that the user picks on purpose for a stopped chat (the footer): Resume, Resume from summary, Start fresh.
extension AppModel {
    public func session(_ ref: SessionRef) -> SessionSummary? {
        (try? state.machine(id: ref.machineID))?.sessions.first { $0.id == ref.sessionID }
    }

    /// Asks Claude to write a summary and continue from it.
    public func compact(_ ref: SessionRef) async -> SessionRef? {
        let id = ref.sessionID
        return try? await runStart(origin: ref, action: "compact the session", intro: "Writing a summary") { try await $0.compact(sessionID: id) }.get()
    }
}
