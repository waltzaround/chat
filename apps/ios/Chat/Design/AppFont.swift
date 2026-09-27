import SwiftUI

/// Public Sans, bundled in Resources/Fonts and listed under UIAppFonts. Sizes follow the
/// system text styles so Dynamic Type still scales them. SF Symbols keep the system font.
enum PublicSans {
    static func face(_ weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: "PublicSans-Bold"
        case .semibold: "PublicSans-SemiBold"
        case .medium: "PublicSans-Medium"
        default: "PublicSans-Regular"
        }
    }

    /// Default point sizes of the iOS text styles at the Large content size.
    static func size(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        @unknown default: 17
        }
    }

    static func uiFont(_ weight: Font.Weight, size: CGFloat) -> UIFont {
        UIFont(name: face(weight), size: size) ?? .systemFont(ofSize: size)
    }
}

extension Font {
    /// Public Sans at a system text style. `.headline` is semibold, as with the system font.
    static func app(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        let weight = weight ?? (style == .headline ? .semibold : .regular)
        return .custom(PublicSans.face(weight), size: PublicSans.size(style), relativeTo: style)
    }

    /// Public Sans at a fixed size, for text inside fixed-size shapes.
    static func app(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(PublicSans.face(weight), fixedSize: size)
    }
}
