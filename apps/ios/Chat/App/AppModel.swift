import Foundation
import Observation

/// One server you're signed in to.
struct Account: Identifiable, Hashable {
    let server: URL
    var token: String
    var me: CurrentUser?

    var id: String { server.absoluteString }
    var host: String { server.host().map { h in server.port.map { "\(h):\($0)" } ?? h } ?? server.absoluteString }
    var api: APIClient { APIClient(server: server, token: token) }

    static func == (a: Account, b: Account) -> Bool { a.server == b.server && a.token == b.token && a.me?.id == b.me?.id }
    func hash(into hasher: inout Hasher) { hasher.combine(server) }
}

/// Every server you're signed in to. The list of servers is kept in UserDefaults and
/// each session token in the Keychain.
@MainActor
@Observable
final class AppModel {
    private(set) var accounts: [Account] = []
    /// Set when a chat:// link arrives, e.g. an invite.
    var pendingLink: URL?

    private static let serversKey = "chat.servers"
    private static let legacyServerKey = "chat.server"

    init() {
        var saved = UserDefaults.standard.stringArray(forKey: Self.serversKey) ?? []
        // Before several servers: a single "chat.server".
        if saved.isEmpty, let legacy = UserDefaults.standard.string(forKey: Self.legacyServerKey) {
            saved = [legacy]
            UserDefaults.standard.removeObject(forKey: Self.legacyServerKey)
        }
        accounts = saved.compactMap { URL(string: $0) }.compactMap { url in
            Keychain.token(for: url).map { Account(server: url, token: $0) }
        }
        persist()
    }

    func account(for server: URL) -> Account? { accounts.first { $0.server == server } }

    func api(for server: URL) -> APIClient? { account(for: server)?.api }

    /// Checks an address answers as a Chat server; returns its origin.
    func checkServer(_ input: String) async throws -> URL {
        guard let url = APIClient.normalize(input) else { throw APIError.server(status: 0, message: "That doesn't look like a web address.") }
        _ = try await APIClient.instance(at: url)
        return url
    }

    func signIn(server: URL, email: String, password: String) async throws {
        let token = try await APIClient(server: server, token: nil).signIn(email: email, password: password)
        Keychain.save(token, for: server)
        let me: CurrentUser? = try? await APIClient(server: server, token: token).get("/api/me")
        let account = Account(server: server, token: token, me: me)
        if let i = accounts.firstIndex(where: { $0.server == server }) {
            accounts[i] = account
        } else {
            accounts.append(account)
        }
        persist()
    }

    func signOut(_ server: URL) async {
        await account(for: server)?.api.signOut()
        remove(server)
    }

    func loadProfiles() async {
        for account in accounts where account.me == nil {
            do {
                let me: CurrentUser = try await account.api.get("/api/me")
                if let i = accounts.firstIndex(where: { $0.server == account.server }) { accounts[i].me = me }
            } catch APIError.signedOut {
                handleSignedOut(account.server)
            } catch {}
        }
    }

    /// The server said 401: that session ended (signed out elsewhere, suspended, deleted).
    func handleSignedOut(_ server: URL) {
        remove(server)
    }

    private func remove(_ server: URL) {
        Keychain.delete(for: server)
        accounts.removeAll { $0.server == server }
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(accounts.map(\.server.absoluteString), forKey: Self.serversKey)
    }
}
