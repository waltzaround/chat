import Foundation

/// What the app shares with its notification service extension through the app group.
enum SharedStore {
    static let appGroup = "group.chat.beacon.ios"

    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    /// This phone's push registration id on each server ("server origin" → device id).
    static var pushDevices: [String: String] {
        get { defaults.dictionary(forKey: "chat.pushDevices") as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: "chat.pushDevices") }
    }

    /// The push key the relay issued for this phone, so a new token re-registers.
    static var pushKey: String? {
        get { defaults.string(forKey: "chat.pushKey") }
        set { defaults.set(newValue, forKey: "chat.pushKey") }
    }
}

/// One entry from /api/push/pending: what a notification says and where it goes.
struct PendingPush: Decodable {
    let title: String
    let body: String
    let kind: String?
    let workspaceId: String?
    let channelId: String
    let channelName: String?
    let messageId: String?
    let author: Author?
    let createdAt: String

    struct Author: Decodable {
        let id: String
        let username: String
        let displayName: String
        let avatarUrl: String?
    }
}
