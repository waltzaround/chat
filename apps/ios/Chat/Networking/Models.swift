import Foundation

// Mirrors of the server's JSON (shared/types.ts). Only the fields the app uses.

struct InstanceInfo: Decodable {
    let software: String
    let version: String
    let apiVersion: Int
    let registration: String
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
    var id: String { workspaceId }
}

struct MessageAuthor: Codable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let avatarUrl: String?
    let nickname: String?
    let roleColour: String?
    var name: String { nickname ?? displayName }
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

    static func parse(_ iso: String) -> Date? { parser.date(from: iso) }

    /// "5m", "3h", "Yesterday" or a short date, for lists.
    static func relative(_ iso: String) -> String {
        guard let date = parse(iso) else { return "" }
        let seconds = Date.now.timeIntervalSince(date)
        if seconds < 60 { return "Just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if Calendar.current.isDateInToday(date) { return "\(Int(seconds / 3600))h ago" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.day().month(.abbreviated))
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
