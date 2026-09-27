import UIKit
import UserNotifications

/**
 * Phone notifications. The app registers with Apple, hands the token to the push relay
 * (Info.plist ChatPushRelay, set by whoever publishes the app) for a push key, and gives
 * that key to each server it's signed in to. Servers then wake the phone through the
 * relay, and the notification service extension fills in the text.
 */
@MainActor
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()
    /// Set by the app once it's up; a tap that arrives earlier (cold start) waits here.
    weak var model: AppModel? {
        didSet {
            if let route = stashedRoute, let model {
                stashedRoute = nil
                model.pendingRoute = route
            }
        }
    }
    private var stashedRoute: Route?

    /// Where this build's push relay lives; empty means this build has no push.
    var relay: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "ChatPushRelay") as? String, !value.isEmpty else { return nil }
        return URL(string: value)
    }

    /// After sign-in: ask once for permission, then register with Apple.
    func start() {
        guard relay != nil, model?.accounts.isEmpty == false else { return }
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken: Data) {
        guard let relay else { return }
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            var request = URLRequest(url: relay.appending(path: "v1/register"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(["platform": "ios", "token": hex])
            guard let (data, _) = try? await URLSession.shared.data(for: request),
                  let key = (try? JSONDecoder().decode([String: String].self, from: data))?["pushKey"] else { return }
            if key != SharedStore.pushKey {
                // A new token: every server needs the new key.
                SharedStore.pushKey = key
                SharedStore.pushDevices = [:]
            }
            await syncAccounts()
        }
    }

    /// Registers this phone with any signed-in server that doesn't know it yet.
    func syncAccounts() async {
        guard let relay, let key = SharedStore.pushKey, let model else { return }
        var devices = SharedStore.pushDevices
        let servers = Set(model.accounts.map(\.server.absoluteString))
        devices = devices.filter { servers.contains($0.key) }
        for account in model.accounts where devices[account.server.absoluteString] == nil {
            struct Body: Encodable { let platform = "ios"; let relay: String; let pushKey: String }
            struct Created: Decodable { let id: String }
            let api = account.api
            if let created: Created = try? await api.send(api.request("/api/push/devices", method: "POST", body: Body(relay: relay.absoluteString, pushKey: key))) {
                devices[account.server.absoluteString] = created.id
            }
        }
        SharedStore.pushDevices = devices
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// In the app, still show it (the channel you're reading has already marked it read).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// Tapping a notification opens its channel or DM.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let server = (info["server"] as? String).flatMap(URL.init(string:)), let workspaceId = info["workspaceId"] as? String, let channelId = info["channelId"] as? String else { return }
        let title = info["channelName"] as? String ?? ""
        var peer: UserSummary?
        if let id = info["peerId"] as? String {
            peer = UserSummary(id: id, username: info["peerUsername"] as? String ?? "", displayName: title, avatarUrl: info["peerAvatarUrl"] as? String)
        }
        let route = Route.channel(server: server, workspaceId: workspaceId, channelId: channelId, title: title, peer: peer)
        await MainActor.run {
            if let model = self.model { model.pendingRoute = route } else { self.stashedRoute = route }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Set before launch finishes, so tapping a notification that launched the app works.
        UNUserNotificationCenter.current().delegate = PushManager.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushManager.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push registration failed: \(error.localizedDescription)")
    }
}
