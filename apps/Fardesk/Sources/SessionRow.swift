import FardeskModels
import FardeskStore
import SwiftUI

/// One session in the list, as the owner's design kit draws it (2026-11-22, `public/docs/design/LIST-ROW.md`):
/// the agent's avatar with the state badge on its corner, the title with the time, then one muted line
/// "State · newest line" of up to two lines, the pin under the time. Inset dividers, one card per machine.
struct SessionRow: View {
    @Environment(SharedClock.self) private var clock
    @AppStorage(ColourCoding.key) private var automaticColours = ColourCoding.defaultValue
    let ref: SessionRef
    let session: SessionSummary

    var body: some View {
        SessionRowContent(
            model: SessionRowModel(session: session, now: clock.now),
            colour: session.shownColor(automatic: automaticColours),
            chatImage: session.label.image.map { ChatImageKey(ref: ref, hash: $0) }
        )
        .tag(Route.session(ref))
        .accessibilityIdentifier("session-row-\(session.id)")
        .sessionRowSwipes(ref: ref, session: session)
        .contextMenu { SessionActionButtons(ref: ref, session: session) }
    }
}

/// Row geometry in points: the kit's layout at WhatsApp's proportions (owner, 2026-11-22: 55 pt avatar, 76 pt rows).
enum RowMetrics {
    static let avatar: CGFloat = 55
    static let leading: CGFloat = 13
    static let gap: CGFloat = 12
    static let trailing: CGFloat = 14.5
    static let minHeight: CGFloat = 76
    static let badge: CGFloat = 24
    static let badgeRing: CGFloat = 3
    static let badgeOffset = CGSize(width: 21, height: 20)
    static let pin: CGFloat = 15
}

struct SessionRowContent: View {
    let model: SessionRowModel
    let colour: LabelColor?
    let chatImage: ChatImageKey?
    @ScaledMetric(relativeTo: .headline) private var titleSize: CGFloat = 17.5
    @ScaledMetric(relativeTo: .subheadline) private var previewSize: CGFloat = 14
    @ScaledMetric(relativeTo: .footnote) private var timeSize: CGFloat = 13.3

    var body: some View {
        HStack(alignment: .center, spacing: RowMetrics.gap) {
            AgentAvatar(agent: model.agent, badge: model.badge, colour: colour, chatImage: chatImage)
            VStack(alignment: .leading, spacing: 3) {
                titleLine
                previewLine
            }
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            .alignmentGuide(.listRowSeparatorTrailing) { $0[.trailing] }
        }
        .frame(maxWidth: .infinity, minHeight: RowMetrics.minHeight, alignment: .leading)
        .contentShape(.rect)
        .listRowInsets(EdgeInsets(top: 0, leading: RowMetrics.leading, bottom: 0, trailing: RowMetrics.trailing))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityLabel)
        // The colour the user gave the chat (the ring), for VoiceOver and the UI tests.
        .accessibilityValue(colour.map { "Colour \($0.hex)" } ?? "")
        .accessibilityAddTraits(.isButton)
    }

    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(model.title)
                .font(.system(size: titleSize, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            if let time = model.time {
                Text(time)
                    .font(.system(size: timeSize))
                    .foregroundStyle(.secondary)
                    .fixedSize()
                    .layoutPriority(1)
            }
        }
    }

    private var previewLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(model.preview)
                .font(.system(size: previewSize))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.pinned {
                Image("row-pin")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: RowMetrics.pin, height: RowMetrics.pin)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The agent's round avatar (the same frame for every agent) with the state badge cut into its bottom corner.
/// A colour the user gave the chat shows as a ring around the avatar. A chat with its own image shows that image
/// in the same circle instead of the agent's avatar.
struct AgentAvatar: View {
    let agent: AgentKind
    let badge: SessionBadge
    let colour: LabelColor?
    let chatImage: ChatImageKey?
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        face
            .frame(width: RowMetrics.avatar, height: RowMetrics.avatar)
            .clipShape(.circle)
            .overlay {
                if let colour { Circle().strokeBorder(colour.swatch, lineWidth: 3) }
            }
            .overlay {
                SessionBadgeView(badge: badge)
                    .offset(x: layoutDirection == .rightToLeft ? -RowMetrics.badgeOffset.width : RowMetrics.badgeOffset.width,
                            y: RowMetrics.badgeOffset.height)
            }
    }
}

extension AgentAvatar {
    @ViewBuilder fileprivate var face: some View {
        if let chatImage {
            ChatImageView(key: chatImage) { agentFace }
        } else {
            agentFace
        }
    }

    private var agentFace: some View {
        Image("avatar-\(agent.rawValue)").resizable().scaledToFit()
    }
}

/// The state badge: a ring in the card colour, a filled disc in the state colour, a white mark
/// (outlined on a pale disc for "in background").
struct SessionBadgeView: View {
    let badge: SessionBadge

    var body: some View {
        let tint = Color(badgeHex: badge.colourHex)
        ZStack {
            Circle().fill(Color.cardSurface)
            Circle()
                .fill(badge.isOutlined ? Color(badgeHex: 0xF3FBF6) : tint)
                .overlay { Circle().strokeBorder(tint, lineWidth: 1.5) }
                .padding(RowMetrics.badgeRing)
            BadgeMark(badge: badge)
                .foregroundStyle(badge.isOutlined ? tint : .white)
        }
        .frame(width: RowMetrics.badge, height: RowMetrics.badge)
        .accessibilityHidden(true)
    }
}

private struct BadgeMark: View {
    let badge: SessionBadge

    var body: some View {
        switch badge {
        case .working, .background:
            HStack(spacing: 2.6) { ForEach(0..<3, id: \.self) { _ in Circle().frame(width: 2.7, height: 2.7) } }
        case .yourTurn:
            Image(systemName: "arrow.uturn.backward").font(.system(size: 10, weight: .bold))
        case .needsYou:
            Image(systemName: "exclamationmark").font(.system(size: 11, weight: .heavy))
        case .stopped:
            RoundedRectangle(cornerRadius: 1).frame(width: 6.5, height: 6.5)
        }
    }
}

extension Color {
    /// The colour of the list card, so the badge ring cuts cleanly into the avatar in light and dark mode.
    static var cardSurface: Color {
        #if os(iOS)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    init(badgeHex hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
