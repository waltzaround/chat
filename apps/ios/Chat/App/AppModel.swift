import Foundation
import Observation

/// Which server the app talks to and who is signed in. The server is remembered in
/// UserDefaults and the session token in the Keychain.
@MainActor
@Observable
final class AppModel {
    private(set) var server: URL?
    private(set) var token: String?
    private(set) var me: CurrentUser?
    /// Set when a chat:// link arrives before sign-in, e.g. an invite.
    var pendingLink: URL?

    private static let serverKey = "chat.server"

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.serverKey), let url = URL(string: saved) {
            server = url
            token = Keychain.token(for: url)
        }
    }

    var api: APIClient? { server.map { APIClient(server: $0, token: token) } }

    /// Validate an address and switch to it (signing out of any other server).
    func chooseServer(_ input: String) async throws {
        guard let url = APIClient.normalize(input) else { throw APIError.server(status: 0, message: "That doesn't look like a web address.") }
        _ = try await APIClient.instance(at: url)
        server = url
        token = Keychain.token(for: url)
        me = nil
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
    }

    func forgetServer() {
        server = nil
        token = nil
        me = nil
        UserDefaults.standard.removeObject(forKey: Self.serverKey)
    }

    func signIn(email: String, password: String) async throws {
        guard let server else { return }
        let token = try await APIClient(server: server, token: nil).signIn(email: email, password: password)
        Keychain.save(token, for: server)
        self.token = token
        await loadMe()
    }

    func signOut() async {
        guard let server else { return }
        await api?.signOut()
        Keychain.delete(for: server)
        token = nil
        me = nil
    }

    func loadMe() async {
        do {
            me = try await api?.get("/api/me")
        } catch APIError.signedOut {
            handleSignedOut()
        } catch {}
    }

    /// The server said 401: the session ended (signed out elsewhere, suspended, deleted).
    func handleSignedOut() {
        if let server { Keychain.delete(for: server) }
        token = nil
        me = nil
    }
}
