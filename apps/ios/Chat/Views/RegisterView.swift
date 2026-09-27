import SwiftUI
import WebKit

/// Creating an account in the app, on servers where the owner allows open sign-up.
struct RegisterView: View {
    @Environment(AppModel.self) private var model
    let server: URL
    let branding: ServerBranding?
    /// The server wants a Turnstile check first (see /app-challenge).
    let challenge: Bool
    var onDone: () -> Void = {}

    @State private var name = ""
    @State private var username = ""
    @State private var usernameEdited = false
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var checkEmail = false
    @State private var showChallenge = false
    @State private var webPage: URL?

    private var agreement: AttributedString {
        let terms = server.appending(path: "terms").absoluteString
        let privacy = server.appending(path: "privacy").absoluteString
        return (try? AttributedString(markdown: "By creating an account you agree to the [terms](\(terms)) and [privacy policy](\(privacy)).")) ?? AttributedString("")
    }

    private var ready: Bool { !username.isEmpty && email.contains("@") && password.count >= 8 }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ServerCard(server: server, branding: branding).padding(.top, 12)
                if checkEmail {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Check your email").font(.app(.headline)).foregroundStyle(Theme.heading)
                        Text("We sent a link to \(email). Open it to confirm your address, then log in.").foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("Create your account")
                        .font(.app(.subheadline))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, -8)
                    field("Your name") {
                        TextField("", text: $name).textContentType(.name)
                            .onChange(of: name) { _, value in if !usernameEdited { username = Self.usernameFrom(value) } }
                    }
                    field("Username", note: "People mention you as @\(username.isEmpty ? "username" : username). Lowercase letters, numbers, dots and underscores.") {
                        TextField("", text: Binding(get: { username }, set: { username = $0.lowercased(); usernameEdited = true }))
                            .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    field("Email") {
                        TextField("", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    field("Password", note: "At least 8 characters.") {
                        SecureField("", text: $password).textContentType(.newPassword)
                    }
                    if let error {
                        Text(error).font(.app(.footnote)).foregroundStyle(Theme.danger).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Button(action: start) {
                        if busy { ProgressView().tint(Theme.onAccent) } else { Text("Create Account") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || !ready)
                    Text(agreement)
                        .font(.app(.caption))
                        .foregroundStyle(Theme.muted)
                        .tint(Theme.link)
                        .environment(\.openURL, OpenURLAction { url in
                            webPage = url
                            return .handled
                        })
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.chat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showChallenge) {
            ChallengeView(url: server.appending(path: "app-challenge")) { token in
                showChallenge = false
                submit(token)
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
    }

    private func field<F: View>(_ label: String, note: String? = nil, @ViewBuilder _ content: () -> F) -> some View {
        VStack(spacing: 8) {
            FieldLabel(text: label)
            content().filledField()
            if let note {
                Text(note).font(.app(.caption)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func start() {
        if challenge { showChallenge = true } else { submit(nil) }
    }

    private func submit(_ token: String?) {
        error = nil
        busy = true
        Task {
            do {
                let displayName = name.trimmingCharacters(in: .whitespaces)
                let signedIn = try await model.register(server: server, name: displayName.isEmpty ? username : displayName, username: username, email: email.trimmingCharacters(in: .whitespaces), password: password, challenge: token)
                if signedIn { onDone() } else { checkEmail = true }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't create the account."
            }
            busy = false
        }
    }

    /// "Walter Lim" → "walter.lim", like the web sign-up.
    static func usernameFrom(_ name: String) -> String {
        let lowered = name.lowercased().replacingOccurrences(of: " ", with: ".")
        return String(lowered.filter { $0.isLetter && $0.isASCII || $0.isNumber || $0 == "." || $0 == "_" }.prefix(32))
    }
}

/// The server's /app-challenge page; solving it navigates to chat://challenge?token=…
struct ChallengeView: UIViewRepresentable {
    let url: URL
    let done: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(Theme.panel)
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let done: (String) -> Void
        init(done: @escaping (String) -> Void) { self.done = done }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url, url.scheme == "chat", url.host() == "challenge" else { return .allow }
            if let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value {
                await MainActor.run { done(token) }
            }
            return .cancel
        }
    }
}
