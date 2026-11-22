import FardeskModels
import Foundation

/// "Remove from list" (right swipe on a stopped chat) and its undo in Settings, Hidden chats.
extension AppModel {
    /// Removes a stopped chat from the list on its machine, then re-reads the list so it goes at once.
    @discardableResult
    public func hide(_ ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        let done = await perform(on: ref.machineID, action: "remove the chat from the list", notice: .failure(ref)) {
            try await $0.hide(sessionID: id)
        } != nil
        if done { await refresh() }
        return done
    }

    /// Brings a removed chat back into the list.
    @discardableResult
    public func unhide(_ ref: SessionRef) async -> Bool {
        let id = ref.sessionID
        let done = await perform(on: ref.machineID, action: "bring the chat back") { try await $0.unhide(sessionID: id) } != nil
        if done { await refresh() }
        return done
    }

    /// The chats removed from the list on one machine, newest first; empty when it does not answer.
    public func hiddenSessions(on machineID: UUID) async -> [HiddenSession] {
        let list = await perform(on: machineID, action: "read the hidden chats", origin: .background) { try await $0.hiddenSessions() }
        return (list ?? []).sorted { $0.updatedAt > $1.updatedAt }
    }
}
