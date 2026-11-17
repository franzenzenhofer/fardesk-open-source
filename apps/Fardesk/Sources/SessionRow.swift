import FardeskModels
import FardeskStore
import SwiftUI

struct SessionRow: View {
    @Environment(AppModel.self) private var model
    @Environment(SessionCoordinator.self) private var coordinator
    @Environment(SharedClock.self) private var clock
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        rowContent(SessionPresentation(session: session, now: clock.now))
            .tag(Route.session(ref))
            .accessibilityIdentifier("session-row-\(session.id)")
            .sessionRowSwipes(ref: ref, session: session)
            .contextMenu {
                Button("Open", systemImage: "arrow.right.circle") { coordinator.selection = ref }
                SessionActionButtons(ref: ref, session: session)
            }
    }

    private func rowContent(_ presentation: SessionPresentation) -> some View {
        HStack(spacing: 12) {
            Image(systemName: glyph.symbolName)
                .font(.title2)
                .foregroundStyle(statusStyle)
                .symbolEffect(.pulse, isActive: glyph.pulses)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title).font(.headline).lineLimit(2)
                Text(presentation.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(presentation.relativeTime).font(.subheadline).foregroundStyle(.secondary)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
    }

    private var glyph: SessionRowGlyph { SessionRowGlyph(status: session.status) }

    private var statusStyle: Color { StateColor.color(glyph.tint) }
}
