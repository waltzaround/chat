import Foundation

// Mirrors of the server's JSON (shared/types.ts). Only the fields the app uses.

struct InstanceInfo: Decodable {
    let server: ServerBranding?
    let software: String
    let version: String
    let apiVersion: Int
    let registration: String
    /** Missing on servers from before in-app registration. */
    let signUp: SignUpInfo?

    struct SignUpInfo: Decodable {
        let open: Bool
        let challenge: Bool
        let requireVerifiedEmail: Bool
    }
}

/// The name, description and icon the server's owner set. All optional.
struct ServerBranding: Decodable {
    let name: String?
    let description: String?
    let iconUrl: String?
}

struct UserSummary: Codable, Hashable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let avatarUrl: String?
}

struct CurrentUser: Decodable {
    let id: String
    let username: String
    let displayName: String
    let avatarUrl: String?
    let email: String
    /// Signs in with a password; deleting the account asks for it.
    var hasPassword: Bool? = nil
}

struct WorkspaceSummary: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let iconUrl: String?
    let memberCount: Int
    let mentionCount: Int
}

struct Category: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let position: Int
}

struct Channel: Decodable, Hashable, Identifiable {
    var isVoice: Bool { kind == "voice" }
    let id: String
    let workspaceId: String
    let categoryId: String?
    let name: String
    let topic: String?
    let kind: String
    let position: Int
    let lastSequence: Int
    let lastReadSequence: Int
    let mentionCount: Int
    let permissions: Int

    var isText: Bool { kind == "text" }
    var isUnread: Bool { lastSequence > lastReadSequence }
    /// Permission bit SEND_MESSAGES (shared/permissions.ts), or ADMINISTRATOR.
    var canSend: Bool { permissions & (1 << 9) != 0 || permissions & 1 != 0 }
}

struct WorkspaceDetail: Decodable {
    let id: String
    let name: String
    let kind: String
    let categories: [Category]
    let channels: [Channel]
    let dmPeer: UserSummary?
}

struct DirectMessage: Decodable, Hashable, Identifiable {
    let workspaceId: String
    let channelId: String
    let peer: UserSummary
    let lastMessageAt: String?
    let unreadCount: Int
    let lastMessage: LastMessage?
    var id: String { workspaceId }

    struct LastMessage: Decodable, Hashable {
        let authorId: String
        let content: String
        let hasAttachments: Bool
    }
}

struct SearchResult: Decodable, Identifiable {
    let message: Message
    let channelName: String
    let snippet: String
    var id: String { message.id }
}

struct SearchResponse: Decodable {
    let results: [SearchResult]
}

struct Invite: Decodable {
    let code: String
    let url: String
}

struct MessageAuthor: Codable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let avatarUrl: String?
    let nickname: String?
    let roleColour: String?
    /// An app: a bot, a webhook or an integration like GitHub. Shown with an "APP" badge.
    var bot = false
    var name: String { nickname ?? displayName }
}

extension MessageAuthor {
    // Servers from before apps don't send `bot`.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = try c.decode(String.self, forKey: .username)
        displayName = try c.decode(String.self, forKey: .displayName)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        nickname = try c.decodeIfPresent(String.self, forKey: .nickname)
        roleColour = try c.decodeIfPresent(String.self, forKey: .roleColour)
        bot = try c.decodeIfPresent(Bool.self, forKey: .bot) ?? false
    }
}

struct Attachment: Codable, Hashable, Identifiable {
    let id: String
    let filename: String
    let mimeType: String
    let width: Int?
    let height: Int?
    let url: String
    var isImage: Bool { mimeType.hasPrefix("image/") }
}

struct ReplyContext: Codable, Hashable {
    let id: String
    let author: UserSummary?
    let content: String
    let deleted: Bool
}

struct Reaction: Codable, Hashable {
    let emoji: String
    let count: Int
    let me: Bool
}

struct ThreadSummary: Codable, Hashable {
    let replyCount: Int
    let lastReplyAt: String?
}

struct Message: Codable, Hashable, Identifiable {
    let id: String
    let channelId: String
    let sequence: Int
    let author: MessageAuthor
    let content: String
    let replyTo: ReplyContext?
    let attachments: [Attachment]
    var reactions: [Reaction]
    let editedAt: String?
    let createdAt: String
    let threadRootId: String?
    let thread: ThreadSummary?
    /// Rich cards from apps, then link previews, in order.
    var embeds: [Embed] = []
    /// Rows of buttons from a bot.
    var components: [ActionRow] = []
    /// The slash command this message answers: "walt used /deploy".
    var interaction: MessageInteraction? = nil
    /// Posted by this incoming webhook.
    var webhookId: String? = nil
    /// Only you see it, until the app restarts; the server never stores it.
    var ephemeral: Bool? = nil

    var isEphemeral: Bool { ephemeral == true }
}

extension Message {
    // Tolerant of servers from before apps, which don't send embeds, buttons and the rest,
    // and of embeds or components this version of the app doesn't understand.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelId = try c.decode(String.self, forKey: .channelId)
        sequence = try c.decode(Int.self, forKey: .sequence)
        author = try c.decode(MessageAuthor.self, forKey: .author)
        content = try c.decode(String.self, forKey: .content)
        replyTo = try c.decodeIfPresent(ReplyContext.self, forKey: .replyTo)
        attachments = try c.decode([Attachment].self, forKey: .attachments)
        reactions = try c.decode([Reaction].self, forKey: .reactions)
        editedAt = try c.decodeIfPresent(String.self, forKey: .editedAt)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        threadRootId = try c.decodeIfPresent(String.self, forKey: .threadRootId)
        thread = try c.decodeIfPresent(ThreadSummary.self, forKey: .thread)
        embeds = c.lossy(Embed.self, forKey: .embeds)
        components = c.lossy(ActionRow.self, forKey: .components)
        interaction = try? c.decodeIfPresent(MessageInteraction.self, forKey: .interaction)
        webhookId = try? c.decodeIfPresent(String.self, forKey: .webhookId)
        ephemeral = try? c.decodeIfPresent(Bool.self, forKey: .ephemeral)
    }
}

struct MessageInteraction: Codable, Hashable {
    let name: String
    let user: UserSummary?
}

/// A card on a message: a "rich" one from an app, or a "link" preview made from a link
/// in the text. Image URLs are server paths (proxied through /api/media), like avatars.
struct Embed: Codable, Hashable {
    let type: String
    var title: String?
    var url: String?
    /// Markdown.
    var description: String?
    /// 0xRRGGBB, drawn as the card's left edge.
    var color: Int?
    /// ISO-8601, shown in the footer.
    var timestamp: String?
    var author: Author?
    var footer: Footer?
    /// Values are Markdown. Inline fields sit side by side, up to three per row.
    var fields: [Field]?
    var image: Image?
    var thumbnail: Thumbnail?
    /// The site a link preview came from.
    var provider: Provider?

    var isLink: Bool { type == "link" }

    struct Author: Codable, Hashable {
        let name: String
        var url: String?
        var iconUrl: String?
    }

    struct Footer: Codable, Hashable {
        let text: String
        var iconUrl: String?
    }

    struct Field: Codable, Hashable {
        let name: String
        let value: String
        var inline: Bool?
    }

    struct Image: Codable, Hashable {
        let url: String
        var width: Int?
        var height: Int?
    }

    struct Thumbnail: Codable, Hashable {
        let url: String
    }

    struct Provider: Codable, Hashable {
        let name: String
        var url: String?
    }
}

/// Up to five buttons side by side on a bot's message.
struct ActionRow: Codable, Hashable {
    var type = "row"
    var components: [ButtonComponent]
}

extension ActionRow {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = (try? c.decode(String.self, forKey: .type)) ?? "row"
        // Kinds of component other than buttons are skipped.
        components = c.lossy(ButtonComponent.self, forKey: .components)
    }
}

/// A "link" button opens `url`; the others send `customId` to the bot.
struct ButtonComponent: Codable, Hashable {
    let type: String
    /// "primary", "secondary", "success", "danger" or "link".
    let style: String
    let label: String
    var customId: String?
    var url: String?
    var disabled: Bool?

    var isLink: Bool { style == "link" }
    var isDisabled: Bool { disabled == true }
}

/// A command the composer offers after "/".
struct AvailableCommand: Decodable, Hashable, Identifiable {
    let name: String
    let description: String
    /// A hint shown after the name, e.g. "<environment>".
    let usage: String?
    /// The bot that answers it, or nil for a command built into the server.
    let bot: UserSummary?

    var id: String { "\(bot?.id ?? "")/\(name)" }
}

/// What running a command or pressing a button did.
struct InteractionResult: Decodable {
    /// The posted message, or one only you can see.
    let message: Message?
    /// The bot will answer later.
    let deferred: Bool?
}

/// Decodes an array, skipping elements this version of the app doesn't understand.
struct LossyArray<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var elements: [Element] = []
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                elements.append(element)
            } else {
                // Step over the element that didn't decode.
                _ = try? container.decode(Skipped.self)
            }
        }
        self.elements = elements
    }

    private struct Skipped: Decodable {}
}

extension KeyedDecodingContainer {
    /// The array under `key`, minus elements that don't decode; empty when missing or null.
    func lossy<T: Decodable>(_ type: T.Type, forKey key: Key) -> [T] {
        ((try? decodeIfPresent(LossyArray<T>.self, forKey: key)) ?? nil)?.elements ?? []
    }
}

struct MessagePage: Decodable {
    let messages: [Message]
    let hasMore: Bool
}

/// A message typed here that the server hasn't confirmed yet.
struct PendingMessage: Identifiable, Hashable {
    let id: String // clientMessageId
    let content: String
    let createdAt: Date
    var replyTo: String?
    var failed = false
}

enum ChatDate {
    private static let parser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Apps' embed timestamps may leave out the fractional seconds.
    private static let wholeSecondsParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ iso: String) -> Date? { parser.date(from: iso) ?? wholeSecondsParser.date(from: iso) }

    /// "now", "5m", "3h", "4d", "2mo", like Discord's DM list.
    static func relative(_ iso: String) -> String {
        guard let date = parse(iso) else { return "" }
        let seconds = max(0, Date.now.timeIntervalSince(date))
        switch seconds {
        case ..<60: return "now"
        case ..<3600: return "\(Int(seconds / 60))m"
        case ..<86400: return "\(Int(seconds / 3600))h"
        case ..<(86400 * 30): return "\(Int(seconds / 86400))d"
        case ..<(86400 * 365): return "\(Int(seconds / (86400 * 30)))mo"
        default: return "\(Int(seconds / (86400 * 365)))y"
        }
    }

    /// "September 27, 2026", for the line between days in a channel.
    static func day(_ date: Date) -> String {
        date.formatted(date: .long, time: .omitted)
    }

    /// "3:12 PM" today, "Yesterday 3:12 PM", or a short date.
    static func label(_ iso: String) -> String {
        guard let date = parse(iso) else { return "" }
        let time = date.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(date) { return time }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday \(time)" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
