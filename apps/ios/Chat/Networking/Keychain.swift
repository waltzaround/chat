import Foundation
import Security

/// Session tokens live in the Keychain, one per server.
enum Keychain {
    private static let service = "chat.beacon.ios.session"

    static func token(for server: URL) -> String? {
        var query = base(server)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String, for server: URL) {
        delete(for: server)
        var item = base(server)
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func delete(for server: URL) {
        SecItemDelete(base(server) as CFDictionary)
    }

    private static func base(_ server: URL) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: server.absoluteString]
    }
}
