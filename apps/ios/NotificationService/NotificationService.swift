import UserNotifications

/**
 * Pushes arrive as "Chat: New message" with the server and this phone's device id and
 * no message text (see apps/push-relay). Before iOS shows one, this asks that server
 * what's new, with the session token the app keeps in the shared keychain, and shows
 * the real sender and text. If it can't (offline, signed out), the placeholder shows.
 */
final class NotificationService: UNNotificationServiceExtension {
    private var content: UNMutableNotificationContent?
    private var deliver: ((UNNotificationContent) -> Void)?
    private var task: URLSessionDataTask?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        deliver = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        self.content = content
        let info = request.content.userInfo
        guard let serverString = info["server"] as? String, let server = URL(string: serverString), let token = Keychain.token(for: server) else {
            return contentHandler(content)
        }
        var components = URLComponents(url: server.appending(path: "api/push/pending"), resolvingAgainstBaseURL: false)!
        if let device = info["device"] as? String { components.queryItems = [URLQueryItem(name: "device", value: device)] }
        var urlRequest = URLRequest(url: components.url!, timeoutInterval: 20)
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        task = URLSession(configuration: config).dataTask(with: urlRequest) { [weak self] data, response, _ in
            guard let self, let content = self.content else { return }
            if (response as? HTTPURLResponse)?.statusCode == 200, let data, let items = try? JSONDecoder().decode([PendingPush].self, from: data), let latest = items.last {
                content.title = latest.title
                content.body = latest.body
                // One conversation per notification group, as in Messages.
                content.threadIdentifier = "\(serverString)|\(latest.channelId)"
                var userInfo = content.userInfo
                userInfo["workspaceId"] = latest.workspaceId
                userInfo["channelId"] = latest.channelId
                userInfo["channelName"] = latest.kind == "dm" ? latest.author?.displayName : latest.channelName
                userInfo["isDm"] = latest.kind == "dm"
                if latest.kind == "dm", let author = latest.author {
                    userInfo["peerId"] = author.id
                    userInfo["peerUsername"] = author.username
                    userInfo["peerAvatarUrl"] = author.avatarUrl
                }
                content.userInfo = userInfo
            }
            self.finish()
        }
        task?.resume()
    }

    /// Out of time: show what we have.
    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
        finish()
    }

    private func finish() {
        guard let deliver, let content else { return }
        self.deliver = nil
        deliver(content)
    }
}
