import SwiftUI

/// Dark palette in the style of Discord mobile, with a neutral accent. The app is always dark.
enum Theme {
    static let accent = Color(hex: "F2F3F5")!
    /// Text and icons drawn on top of `accent`.
    static let onAccent = Color(hex: "1E1F22")!
    static let rail = Color(hex: "1E1F22")!
    static let panel = Color(hex: "2B2D31")!
    static let chat = Color(hex: "313338")!
    static let field = Color(hex: "1E1F22")!
    static let raised = Color(hex: "383A40")!
    static let hover = Color(hex: "404249")!
    static let text = Color(hex: "DBDEE1")!
    static let heading = Color(hex: "F2F3F5")!
    static let muted = Color(hex: "949BA4")!
    static let faint = Color(hex: "80848E")!
    static let danger = Color(hex: "F23F43")!
    static let link = Color(hex: "00A8FC")!
}

/// Full-width accent button used on the welcome and sign-in screens.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.app(.body, weight: .semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.accent.opacity(configuration.isPressed ? 0.8 : 1)))
            .opacity(enabled ? 1 : 0.5)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.app(.body, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.raised.opacity(configuration.isPressed ? 0.7 : 1)))
    }
}

/// Uppercase label above a filled field, like Discord's forms.
struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.app(.caption, weight: .bold))
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    func filledField() -> some View {
        padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.field))
            .foregroundStyle(Theme.heading)
    }
}

/// Red pill with a count, as on Discord's server icons and DMs.
struct CountBadge: View {
    let count: Int
    var ring: Color = Theme.rail
    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(.app(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Capsule().fill(Theme.danger))
                .padding(3)
                .background(Capsule().fill(ring))
                .accessibilityLabel("\(count) unread mentions")
        }
    }
}

/// The app's mark: a speech bubble on the accent.
struct AppMark: View {
    var size: CGFloat = 48
    var body: some View {
        Image(systemName: "bubble.left.and.bubble.right.fill")
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.33, style: .continuous).fill(Theme.accent))
    }
}
