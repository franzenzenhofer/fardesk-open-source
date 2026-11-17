import FardeskStore
import SwiftUI
import WidgetKit

struct WaitingEntry: TimelineEntry {
    let date: Date
    let snapshot: WaitingSnapshot?

    var count: Int { snapshot?.count ?? 0 }
    var headline: String { snapshot?.oldestTitle ?? "All clear" }
    var machine: String? { snapshot?.oldestMachine }
}

/// Reads the snapshot the app writes into the App Group; the app reloads the timeline when it changes.
struct WaitingProvider: TimelineProvider {
    func placeholder(in context: Context) -> WaitingEntry {
        WaitingEntry(date: .now, snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (WaitingEntry) -> Void) {
        completion(current())
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<WaitingEntry>) -> Void) {
        completion(Timeline(entries: [current()], policy: .never))
    }

    private func current() -> WaitingEntry {
        WaitingEntry(date: .now, snapshot: WaitingSnapshotStore.appGroup?.read())
    }
}

struct WaitingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FardeskWaiting", provider: WaitingProvider()) { entry in
            WaitingWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Waiting")
        .description("Sessions that need you.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct WaitingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WaitingEntry

    var body: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Waiting", systemImage: FardeskSymbol.waiting)
                .font(.caption.weight(.semibold))
                .foregroundStyle(entry.count > 0 ? .orange : .secondary)
            Text(entry.count, format: .number)
                .font(.system(size: 44, weight: .semibold, design: .rounded))
            Spacer(minLength: 0)
            oldestLines(headline: .headline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: FardeskSymbol.waiting).font(.caption)
                Text(entry.count, format: .number).font(.title2.weight(.semibold))
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label("\(entry.count) waiting", systemImage: FardeskSymbol.waiting)
                .font(.headline)
                .widgetAccentable()
            oldestLines(headline: .subheadline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func oldestLines(headline: Font) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.headline).font(headline).lineLimit(1)
            if let machine = entry.machine {
                Text(machine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
