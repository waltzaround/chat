import Foundation

enum APIError: LocalizedError {
    case server(status: Int, message: String)
    case signedOut
    case notAChatServer

    var errorDescription: String? {
        switch self {
        case let .server(_, message): return message
        case .signedOut: return "You've been signed out."
        case .notAChatServer: return "That address isn't a Chat server."
        }
    }
}

/// Talks to one Chat server with a bearer token (see the server's bearer plugin).
struct APIClient {
    let server: URL
    let token: String?

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        // Native apps authenticate with the token only; no cookies.
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    /// Turns "chat.example.com" or "https://chat.example.com/w/1" into the server's origin.
    static func normalize(_ input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard var parts = URLComponents(string: withScheme), let scheme = parts.scheme, ["http", "https"].contains(scheme), parts.host != nil else { return nil }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    /// Checks the address answers as a Chat server before anyone signs in.
    static func instance(at server: URL) async throws -> InstanceInfo {
        let (data, response) = try await session.data(from: server.appending(path: "api/instance"))
        guard (response as? HTTPURLResponse)?.statusCode == 200, let info = try? JSONDecoder().decode(InstanceInfo.self, from: data), info.software == "beacon-chat" else {
            throw APIError.notAChatServer
        }
        return info
    }

    /// Absolute URL for a server path such as an avatar's "/api/files/…".
    func resolve(_ path: String) -> URL? {
        URL(string: path, relativeTo: server)?.absoluteURL
    }

    func request(_ path: String, method: String = "GET", body: (any Encodable)? = nil) -> URLRequest {
        // Paths like "/api/channels/x/messages?limit=50" resolve against the server's origin.
        let url = URL(string: path.hasPrefix("/") ? path : "/\(path)", relativeTo: server)!.absoluteURL
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(body)
        }
        return request
    }

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send(request(path), as: type)
    }

    func send<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
        let data = try await raw(request)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @discardableResult
    func raw(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await Self.session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.signedOut }
        guard (200 ..< 300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.message ?? "Something went wrong (\(status))."
            throw APIError.server(status: status, message: message)
        }
        return data
    }

    /// Signs in and returns the session token from the set-auth-token header.
    func signIn(email: String, password: String) async throws -> String {
        let (data, response) = try await Self.session.data(for: request("api/auth/sign-in/email", method: "POST", body: ["email": email, "password": password]))
        let http = response as? HTTPURLResponse
        guard http?.statusCode == 200, let token = http?.value(forHTTPHeaderField: "set-auth-token") else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.message ?? "Sign in failed."
            throw APIError.server(status: http?.statusCode ?? 0, message: message)
        }
        return token
    }

    func signOut() async {
        _ = try? await raw(request("api/auth/sign-out", method: "POST", body: [String: String]()))
    }

    func loadImageData(_ path: String) async throws -> Data {
        guard let url = resolve(path) else { throw APIError.notAChatServer }
        var request = URLRequest(url: url)
        // Only our own server gets the token; images elsewhere (e.g. Google avatars) don't.
        if url.host == server.host, let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return try await raw(request)
    }
}

/// Error bodies look like {"error": {"code": "...", "message": "..."}} or Better Auth's {"message": "..."}.
private struct ErrorBody: Decodable {
    let message: String?

    private struct Inner: Decodable { let message: String? }
    private enum Keys: String, CodingKey { case error, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        if let inner = try? c.decode(Inner.self, forKey: .error) { message = inner.message } else { message = try? c.decode(String.self, forKey: .message) }
    }
}
