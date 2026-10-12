import SwiftUI

/// An app's rich card or a link preview under a message, like Discord's embeds: a coloured
/// left edge, the site or author, a title that opens its link, Markdown text, fields,
/// a thumbnail on the right, a full-width image and a footer.
struct EmbedCard: View {
    let embed: Embed
    let api: APIClient?
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if hasBody {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        if let provider = embed.provider { providerLine(provider) }
                        if let author = embed.author { authorLine(author) }
                        if let title = embed.title, !title.isEmpty { titleLine(title) }
                        if let description = embed.description, !description.isEmpty {
                            MarkdownText(content: description, style: .subheadline)
                        }
                        if let fields = embed.fields, !fields.isEmpty { fieldGrid(fields) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let thumbnail = embed.thumbnail {
                        RemoteImage(path: thumbnail.url, api: api) { Theme.raised }
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                            .accessibilityHidden(true)
                    }
                }
            }
            if let image = embed.image { imageView(image) }
            if !footerText.isEmpty { footerLine }
        }
        .padding(.leading, 16)
        .padding([.top, .bottom, .trailing], 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .overlay(alignment: .leading) {
            Rectangle().fill(embed.color.map { Color(rgb: $0) } ?? Theme.raised).frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .frame(maxWidth: 520, alignment: .leading)
    }

    private var hasBody: Bool {
        embed.provider != nil || embed.author != nil || !(embed.title ?? "").isEmpty || !(embed.description ?? "").isEmpty || !(embed.fields ?? []).isEmpty || embed.thumbnail != nil
    }

    /// The site a link preview came from, small above the title.
    private func providerLine(_ provider: Embed.Provider) -> some View {
        linked(provider.url) {
            Text(provider.name).font(.app(.caption)).foregroundStyle(Theme.muted).lineLimit(1)
        }
    }

    private func authorLine(_ author: Embed.Author) -> some View {
        linked(author.url) {
            HStack(spacing: 8) {
                if let icon = author.iconUrl {
                    RemoteImage(path: icon, api: api) { Circle().fill(Theme.raised) }
                        .frame(width: 20, height: 20)
                        .clipShape(Circle())
                        .accessibilityHidden(true)
                }
                Text(author.name).font(.app(.footnote, weight: .semibold)).foregroundStyle(Theme.heading).lineLimit(1)
            }
        }
    }

    private func titleLine(_ title: String) -> some View {
        linked(embed.url) {
            Text(title)
                .font(.app(.subheadline, weight: .bold))
                .foregroundStyle(WebLink.url(embed.url) == nil ? Theme.heading : Theme.link)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityAddTraits(.isHeader)
    }

    /// Inline fields sit side by side, up to three to a row; the others take a row each.
    private func fieldGrid(_ fields: [Embed.Field]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(Self.rows(fields).enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, field in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(field.name).font(.app(.footnote, weight: .semibold)).foregroundStyle(Theme.heading)
                                .fixedSize(horizontal: false, vertical: true)
                            MarkdownText(content: field.value, style: .subheadline)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(.top, 2)
    }

    static func rows(_ fields: [Embed.Field]) -> [[Embed.Field]] {
        var rows: [[Embed.Field]] = []
        for field in fields {
            if field.inline == true, let last = rows.last, last.count < 3, last.allSatisfy({ $0.inline == true }) {
                rows[rows.count - 1].append(field)
            } else {
                rows.append([field])
            }
        }
        return rows
    }

    /// Full width, keeping the image's shape, up to 300pt tall.
    @ViewBuilder
    private func imageView(_ image: Embed.Image) -> some View {
        if let width = image.width, let height = image.height, width > 0, height > 0 {
            RemoteImage(path: image.url, api: api) { Theme.raised }
                .aspectRatio(CGFloat(width) / CGFloat(height), contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                .frame(maxWidth: .infinity, maxHeight: 300, alignment: .leading)
                .accessibilityHidden(true)
        } else {
            RemoteImage(path: image.url, api: api, fit: true) {
                Theme.raised.aspectRatio(16 / 9, contentMode: .fit)
            }
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            .frame(maxWidth: .infinity, maxHeight: 300, alignment: .leading)
            .accessibilityHidden(true)
        }
    }

    private var footerText: String {
        [embed.footer?.text ?? "", embed.timestamp.map(ChatDate.label) ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    private var footerLine: some View {
        HStack(spacing: 6) {
            if let icon = embed.footer?.iconUrl {
                RemoteImage(path: icon, api: api) { Circle().fill(Theme.raised) }
                    .frame(width: 20, height: 20)
                    .clipShape(Circle())
                    .accessibilityHidden(true)
            }
            Text(footerText)
                .font(.app(.caption, weight: .medium))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Opens `url` in the browser when tapped, if it's a web link; otherwise just the content.
    @ViewBuilder
    private func linked<Content: View>(_ url: String?, @ViewBuilder content: () -> Content) -> some View {
        if let url = WebLink.url(url) {
            Button { openURL(url) } label: { content() }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
        } else {
            content()
        }
    }
}

/// A bot's rows of buttons under its message.
struct MessageButtons: View {
    let rows: [ActionRow]
    let pressing: (ButtonComponent) -> Bool
    /// Nil where buttons can't be pressed, e.g. on a message only you can see (the server
    /// doesn't keep those). Link buttons still open their page.
    let press: ((ButtonComponent) -> Void)?
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                FlowLayout(spacing: 8) {
                    ForEach(Array(row.components.enumerated()), id: \.offset) { _, button in
                        buttonView(button)
                    }
                }
            }
        }
    }

    private func buttonView(_ button: ButtonComponent) -> some View {
        let link = WebLink.url(button.url)
        let disabled = button.isDisabled || (button.isLink ? link == nil : (press == nil || button.customId == nil))
        let busy = !button.isLink && pressing(button)
        let colours = Self.colours(button.style)
        return Button {
            if button.isLink {
                if let link { openURL(link) }
            } else {
                press?(button)
            }
        } label: {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.small).tint(colours.foreground) }
                Text(button.label).lineLimit(1)
                if button.isLink {
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .bold))
                }
            }
            .font(.app(.subheadline, weight: .medium))
            .foregroundStyle(colours.foreground)
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
        }
        .buttonStyle(FilledButtonStyle(fill: colours.background))
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityAddTraits(button.isLink ? .isLink : [])
    }

    static func colours(_ style: String) -> (background: Color, foreground: Color) {
        switch style {
        case "primary": (Theme.accent, Theme.onAccent)
        case "success": (Theme.success, .white)
        case "danger": (Theme.danger, .white)
        default: (Theme.raised, Theme.heading) // secondary and link
        }
    }

    private struct FilledButtonStyle: ButtonStyle {
        let fill: Color
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(fill.opacity(configuration.isPressed ? 0.8 : 1)))
        }
    }
}

/// The small "APP" tag after a bot's, webhook's or integration's name.
struct AppBadge: View {
    var body: some View {
        Text("APP")
            .font(.app(size: 10, weight: .bold))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 3, style: .continuous).fill(Theme.raised))
            .accessibilityLabel("App")
    }
}

enum WebLink {
    /// Only web links: an app's URL shouldn't open anything else on the phone.
    static func url(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host() != nil else { return nil }
        return url
    }
}
