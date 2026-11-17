import Foundation

/// When the feed follows the newest row and when it shows the "New activity" pill.
public enum FeedPinning {
    public enum Action: Equatable, Sendable {
        case scrollToBottom
        case showNewActivityPill
        case nothing
    }

    /// What to do when rows were added. The user's own message always scrolls; so does being at the
    /// bottom; a feed that fits the screen never scrolls and never shows a pill.
    public static func onNewRows(userJustSent: Bool, isNearBottom: Bool, contentFitsViewport: Bool) -> Action {
        if userJustSent || isNearBottom { return .scrollToBottom }
        return contentFitsViewport ? .nothing : .showNewActivityPill
    }

    /// The pill shows only for an unread row while the user is scrolled up.
    public static func pillVisible(hasNewActivity: Bool, isNearBottom: Bool, contentFitsViewport: Bool) -> Bool {
        hasNewActivity && !isNearBottom && !contentFitsViewport
    }
}
