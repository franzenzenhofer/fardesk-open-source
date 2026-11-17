import ActivityKit
import FardeskStore
import SwiftUI
import WidgetKit

/// The Dynamic Island and Lock Screen presentation of the pinned session.
struct PinnedSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FardeskActivityAttributes.self) { context in
            PinnedSessionLockScreen(content: context.state)
                .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SessionStatusIcon(content: context.state)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.projectName).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.statusLabel).font(.caption).foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    SessionDetailLines(content: context.state)
                }
            } compactLeading: {
                SessionStatusIcon(content: context.state)
            } compactTrailing: {
                Text(context.state.projectName).lineLimit(1).frame(maxWidth: 60)
            } minimal: {
                SessionStatusIcon(content: context.state)
            }
        }
    }
}

private struct PinnedSessionLockScreen: View {
    let content: LiveActivityContent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            SessionStatusIcon(content: content)
            VStack(alignment: .leading, spacing: 2) {
                Text(content.projectName).font(.headline).lineLimit(1)
                SessionDetailLines(content: content)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct SessionDetailLines: View {
    let content: LiveActivityContent

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(content.machineName)\(FeedSymbol.separator)\(content.statusLabel)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let tool = content.lastToolTitle {
                Text(tool).font(.caption).lineLimit(1)
            }
        }
    }
}

private struct SessionStatusIcon: View {
    let content: LiveActivityContent

    var body: some View {
        Image(systemName: content.isWaiting ? FardeskSymbol.waiting : FardeskSymbol.working)
            .foregroundStyle(content.isWaiting ? .orange : .blue)
    }
}
