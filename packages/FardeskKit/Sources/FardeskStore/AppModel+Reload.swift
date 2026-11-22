import Foundation

/// "Reload chat" (Actions > More): when a chat looks stuck (an old bubble that never turns into a row, a card for
/// something already answered), it throws away everything this device holds for that chat and shows the machine's
/// newest page, so what is on screen is exactly what the machine has. It never touches the session itself.
extension AppModel {
    public func reloadChat(_ ref: SessionRef) async {
        dirtyFeeds.remove(ref)
        feeds.clear(ref)
        outbox.dropSent(for: ref)
        stepLogs[ref] = nil
        do {
            try configuration.cache.removeFeed(machineID: ref.machineID, sessionID: ref.sessionID)
        } catch {
            raise("Fardesk: could not delete the cached chat: \(ErrorText.detail(error))", area: "reload the chat", error: error)
        }
        let id = ref.sessionID
        let step = beginStep(ref, "Reloading the chat from \(machineName(ref.machineID))...")
        guard let page = await perform(
            on: ref.machineID, action: "reload the chat", notice: .failure(ref),
            { try await $0.activity(sessionID: id, before: nil, limit: Self.firstPageRows) }
        ) else {
            failStep(ref, step, reason: "the machine did not answer")
            return
        }
        finishStep(ref, step, as: "Reloaded \(page.items.count) rows")
        refreshFeed(with: page, of: ref)
    }
}
