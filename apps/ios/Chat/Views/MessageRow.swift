import SwiftUI

/// One message, laid out like Discord: avatar, coloured name and time, then the body,
/// attachments, apps' cards and buttons, reactions and thread link.
struct MessageRow: View {
    let message: Message
    let grouped: Bool
    let me: CurrentUser?
    let api: APIClient?
    let react: (String) -> Void
    /// Opens this message's thread; nil inside a thread.
    var openThread: (() -> Void)? = nil
    /// Sends a button press to the bot; nil where buttons can't be pressed.
    var press: ((ButtonComponent) -> Void)? = nil
    /// Whether a button is waiting on its bot.
    var pressing: (ButtonComponent) -> Bool = { _ in false }
    /// Hides a message only you can see.
    var dismiss: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let reply = message.replyTo { replyLine(reply) }
            if let interaction = message.interaction { interactionLine(interaction) }
            HStack(alignment: .top, spacing: 10) {
                if grouped {
                    Color.clear.frame(width: 34, height: 1)
                } else {
                    Avatar(user: UserSummary(id: message.author.id, username: message.author.username, displayName: message.author.name, avatarUrl: message.author.avatarUrl), size: 34)
                }
                VStack(alignment: .leading, spacing: 4) {
                    if !grouped {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(message.author.name).font(.app(.callout, weight: .semibold)).foregroundStyle(colour).lineLimit(1)
                                if message.author.bot { AppBadge() }
                            }
                            Text(ChatDate.label(message.createdAt)).font(.app(.caption)).foregroundStyle(Theme.faint)
                        }
                    }
                    if !message.content.isEmpty {
                        MarkdownText(content: message.content, suffix: edited)
                    }
                    ForEach(message.attachments.filter(\.isImage)) { attachment in
                        RemoteImage(path: attachment.url, api: api) { Theme.panel }
                            .aspectRatio(CGFloat(attachment.width ?? 4) / CGFloat(max(attachment.height ?? 3, 1)), contentMode: .fit)
                            .frame(maxWidth: 280, maxHeight: 280, alignment: .leading)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .padding(.top, 2)
                    }
                    ForEach(message.attachments.filter { !$0.isImage }) { attachment in
                        HStack(spacing: 10) {
                            Image(systemName: "doc.fill").font(.title2).foregroundStyle(Theme.accent)
                            Text(attachment.filename).font(.app(.subheadline, weight: .medium)).foregroundStyle(Theme.link).lineLimit(1)
                        }
                        .padding(12)
                        .frame(maxWidth: 280, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.rail, lineWidth: 1))
                    }
                    ForEach(Array(message.embeds.enumerated()), id: \.offset) { _, embed in
                        EmbedCard(embed: embed, api: api).padding(.top, 2)
                    }
                    if !message.components.isEmpty {
                        MessageButtons(rows: message.components, pressing: pressing, press: message.isEphemeral ? nil : press)
                            .padding(.top, 2)
                    }
                    if !message.reactions.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(message.reactions, id: \.emoji) { reaction in
                                ReactionPill(reaction: reaction) { react(reaction.emoji) }
                            }
                        }
                        .padding(.top, 2)
                    }
                    if let thread = message.thread, thread.replyCount > 0 {
                        Button { openThread?() } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                                Text("\(thread.replyCount) \(thread.replyCount == 1 ? "reply" : "replies")")
                            }
                            .font(.app(.footnote, weight: .semibold))
                            .foregroundStyle(Theme.link)
                            .padding(.top, 2)
                        }
                        .buttonStyle(.plain)
                        .disabled(openThread == nil)
                        .accessibilityHint("Opens the thread")
                    }
                    if message.isEphemeral { ephemeralLine }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, grouped ? 2 : (message.replyTo == nil && message.interaction == nil ? 14 : 4))
        .padding(.bottom, 2)
        .background(mentionsMe ? Color(hex: "F0B232")!.opacity(0.08) : .clear)
        .overlay(alignment: .leading) {
            if mentionsMe { Rectangle().fill(Color(hex: "F0B232")!).frame(width: 2) }
        }
        .contentShape(Rectangle())
    }

    /// The small "↱ Name: quoted text" line above a reply.
    private func replyLine(_ reply: ReplyContext) -> some View {
        HStack(spacing: 6) {
            ReplySpine().stroke(Theme.faint, lineWidth: 2).frame(width: 28, height: 10).padding(.leading, 17).padding(.top, 6)
            if reply.deleted {
                Text("Original message was deleted").italic()
            } else {
                if let author = reply.author { Avatar(user: author, size: 16) }
                Text(reply.author?.displayName ?? "Deleted user").font(.app(.footnote, weight: .semibold)).foregroundStyle(Theme.text)
                Text(reply.content).lineLimit(1)
            }
        }
        .font(.app(.footnote))
        .foregroundStyle(Theme.muted)
        .padding(.top, 10)
        .padding(.bottom, 2)
    }

    /// "↱ walt used /deploy" above an app's answer to a slash command.
    private func interactionLine(_ interaction: MessageInteraction) -> some View {
        HStack(spacing: 6) {
            ReplySpine().stroke(Theme.faint, lineWidth: 2).frame(width: 28, height: 10).padding(.leading, 17).padding(.top, 6)
            if let user = interaction.user { Avatar(user: user, size: 16) }
            Image(systemName: "slash.circle.fill").font(.system(size: 12)).foregroundStyle(Theme.faint)
            Text(interaction.user?.displayName ?? "Someone").font(.app(.footnote, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
            Text("used").layoutPriority(1)
            Text("/\(interaction.name)").font(.app(.footnote, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
        }
        .font(.app(.footnote))
        .foregroundStyle(Theme.muted)
        .padding(.top, 10)
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
    }

    /// Under a message only you can see.
    private var ephemeralLine: some View {
        HStack(spacing: 5) {
            Image(systemName: "eye.fill").font(.system(size: 11))
            Text("Only you can see this")
            Text("·")
            Button("Dismiss") { dismiss?() }
                .font(.app(.caption, weight: .semibold))
                .foregroundStyle(Theme.link)
                .buttonStyle(.plain)
                .accessibilityHint("Hides this message")
        }
        .font(.app(.caption))
        .foregroundStyle(Theme.muted)
        .padding(.top, 2)
    }

    private var mentionsMe: Bool {
        if message.replyTo?.author?.id == me?.id && me != nil && message.author.id != me?.id { return true }
        let text = message.content
        if text.contains("@everyone") || text.contains("@here") { return true }
        guard let username = me?.username else { return false }
        return text.range(of: "@\(username)\\b", options: [.regularExpression, .caseInsensitive]) != nil
    }

    private var colour: Color {
        guard let hex = message.author.roleColour else { return Theme.heading }
        return Color(hex: hex) ?? Theme.heading
    }

    private var edited: AttributedString {
        guard message.editedAt != nil else { return "" }
        var text = AttributedString(" (edited)")
        text.font = .app(.caption)
        text.foregroundColor = Theme.faint
        return text
    }
}

/// Message Markdown: inline styles (bold, italics, code, links), @mentions as chips, and
/// "> " quotes with Discord's side bar. Used for messages and for apps' cards.
struct MarkdownText: View {
    let content: String
    /// Added after the last line, e.g. " (edited)".
    var suffix: AttributedString = ""
    var style: Font.TextStyle = .callout

    var body: some View {
        let blocks = Self.blocks(content)
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                let text = rendered(block.text) + (index == blocks.count - 1 ? suffix : "")
                if block.quote {
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 2).fill(Theme.faint).frame(width: 4)
                        Text(text).messageText(style)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(text).messageText(style)
                }
            }
        }
    }

    /// Splits "> quoted" lines from the rest, so quotes can get Discord's side bar.
    static func blocks(_ content: String) -> [(quote: Bool, text: String)] {
        var out: [(quote: Bool, text: String)] = []
        for line in content.components(separatedBy: "\n") {
            let quote = line.hasPrefix("> ") || line == ">"
            let text = quote ? String(line.dropFirst(min(2, line.count))) : line
            if let last = out.last, last.quote == quote {
                out[out.count - 1].text += "\n" + text
            } else {
                out.append((quote, text))
            }
        }
        return out
    }

    /// Inline Markdown (bold, italics, code, links) with @mentions as chips.
    private func rendered(_ text: String) -> AttributedString {
        var result = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
        for run in result.runs where run.inlinePresentationIntent?.contains(.code) == true {
            result[run.range].backgroundColor = Theme.rail
            result[run.range].font = .system(style == .callout ? .subheadline : .footnote, design: .monospaced)
        }
        let plain = String(result.characters)
        for match in plain.matches(of: /@[A-Za-z0-9_.]+/) {
            let start = plain.distance(from: plain.startIndex, to: match.range.lowerBound)
            let length = plain.distance(from: match.range.lowerBound, to: match.range.upperBound)
            let lower = result.characters.index(result.startIndex, offsetBy: start)
            let upper = result.characters.index(lower, offsetBy: length)
            result[lower ..< upper].foregroundColor = Theme.heading
            result[lower ..< upper].backgroundColor = Theme.accent.opacity(0.3)
            result[lower ..< upper].font = .app(style, weight: .medium)
        }
        return result
    }
}

private extension Text {
    func messageText(_ style: Font.TextStyle = .callout) -> some View {
        font(.system(style))
            .foregroundStyle(Theme.text)
            .tint(Theme.link)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The curved line joining a reply to the message it answers.
struct ReplySpine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + 6))
        path.addQuadCurve(to: CGPoint(x: rect.minX + 6, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return path
    }
}

struct ReactionPill: View {
    let reaction: Reaction
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(reaction.emoji).font(.app(.subheadline))
                Text("\(reaction.count)").font(.app(.subheadline, weight: .semibold))
                    .foregroundStyle(reaction.me ? Theme.heading : Theme.muted)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8).fill(reaction.me ? Theme.accent.opacity(0.25) : Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(reaction.me ? Theme.accent : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(reaction.emoji), \(reaction.count)\(reaction.me ? ", you reacted" : "")")
    }
}

struct PendingRow: View {
    let pending: PendingMessage
    let me: CurrentUser?
    let grouped: Bool
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if grouped || me == nil {
                Color.clear.frame(width: 34, height: 1)
            } else if let me {
                Avatar(user: UserSummary(id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl), size: 34)
            }
            VStack(alignment: .leading, spacing: 4) {
                if !grouped, let me {
                    Text(me.displayName).font(.app(.callout, weight: .semibold)).foregroundStyle(Theme.heading)
                }
                Text(pending.content).font(.app(.callout)).foregroundStyle(Theme.faint)
                if pending.failed {
                    Button("Message failed to send. Tap to retry.", action: retry).font(.app(.caption, weight: .medium)).foregroundStyle(Theme.danger)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, grouped ? 2 : 14)
    }
}

/// Wraps its children onto new lines, for reaction pills.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(subviews, width: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, point) in zip(subviews, arrange(subviews, width: bounds.width).points) {
            subview.place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (points: [CGPoint], size: CGSize) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (points, CGSize(width: widest, height: y + rowHeight))
    }
}

extension Color {
    /// From a number like 0x5865F2, as apps send embed colours.
    init(rgb: Int) {
        self.init(red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }

    init?(hex: String) {
        var value: UInt64 = 0
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, Scanner(string: digits).scanHexInt64(&value) else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}
