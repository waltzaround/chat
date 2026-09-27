import Foundation
import Security

/// Session tokens live in the Keychain, one per server, in the app group's access group
/// so the notification service extension can fetch what a push is about.
enum Keychain {
    private static let service = "chat.app.ios.session"

    static func token(for server: URL) -> String? {
        if let token = read(server, group: SharedStore.appGroup) { return token }
        // Saved before the extension existed: move it into the shared group.
        guard let legacy = read(server, group: nil) else { return nil }
        save(legacy, for: server)
        return legacy
    }

    static func save(_ token: String, for server: URL) {
        delete(for: server)
        var item = base(server, group: SharedStore.appGroup)
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(item as CFDictionary, nil) != errSecSuccess {
            // No app group entitlement (e.g. an unsigned build): keep it app-only.
            var local = base(server, group: nil)
            local[kSecValueData as String] = Data(token.utf8)
            local[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(local as CFDictionary, nil)
        }
    }

    static func delete(for server: URL) {
        SecItemDelete(base(server, group: SharedStore.appGroup) as CFDictionary)
        SecItemDelete(base(server, group: nil) as CFDictionary)
    }

    private static func read(_ server: URL, group: String?) -> String? {
        var query = base(server, group: group)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func base(_ server: URL, group: String?) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: server.absoluteString]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }
}
