import SwiftUI

/// The kinds of button in Fardesk.
enum FardeskButtonRole {
    /// Send, Allow, New: solid black (white in dark mode) with the opposite text.
    case primary
    /// Deny, Resume, Retry: flat grey.
    case secondary
    /// End session: flat grey, red words.
    case destructive
    /// The machine chips of the table of contents.
    case chip
}

/// Clean and high contrast: flat fills, no gradient, no shadow, no shine, never a warm tint. A press dims the
/// button; nothing changes on hover.
struct FardeskButtonStyle: ButtonStyle {
    let role: FardeskButtonRole

    func makeBody(configuration: Configuration) -> some View {
        FardeskButtonBody(role: role, configuration: configuration)
    }
}

/// Plain black and white, not `Color.primary`: on a material (the request card) semantic colours turn vibrant and
/// a black Allow button became grey.
private struct FardeskButtonBody: View {
    @Environment(\.colorScheme) private var scheme
    let role: FardeskButtonRole
    let configuration: ButtonStyleConfiguration

    private var ink: Color { scheme == .dark ? .white : .black }
    private var paper: Color { scheme == .dark ? .black : .white }
    private var isChip: Bool { role == .chip }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: isChip ? 22 : 12, style: .continuous)
        configuration.label
            .font(isChip ? .subheadline.weight(.semibold) : .body.weight(.semibold))
            .foregroundStyle(text)
            .padding(.horizontal, isChip ? 14 : 20)
            .padding(.vertical, isChip ? 10 : 12)
            .frame(minWidth: isChip ? 44 : 88, minHeight: isChip ? 44 : 50)
            .background(fill, in: shape)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(shape)
    }

    private var fill: Color {
        switch role {
        case .primary: ink
        case .secondary, .destructive, .chip: ink.opacity(0.08)
        }
    }

    private var text: Color {
        switch role {
        case .primary: paper
        case .secondary, .chip: ink
        case .destructive: StateColor.broken
        }
    }
}

extension ButtonStyle where Self == FardeskButtonStyle {
    static var fardeskPrimary: FardeskButtonStyle { FardeskButtonStyle(role: .primary) }
    static var fardeskSecondary: FardeskButtonStyle { FardeskButtonStyle(role: .secondary) }
    static var fardeskDestructive: FardeskButtonStyle { FardeskButtonStyle(role: .destructive) }
    static var fardeskChip: FardeskButtonStyle { FardeskButtonStyle(role: .chip) }
}
