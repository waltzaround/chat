import SwiftUI

/// Email and password sign-in. Creating an account and resetting a password happen on
/// the server's web pages, which handle invites, confirmation email and bot checks.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    let server: URL
    var onDone: () -> Void = {}
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var webPage: URL?
    @State private var branding: ServerBranding?
    @State private var instance: InstanceInfo?
    @State private var registering = false
    @FocusState private var field: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ServerCard(server: server, branding: branding)
                    .padding(.top, 12)
                Text("Log in to continue")
                    .font(.app(.subheadline))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, -8)

                VStack(spacing: 8) {
                    FieldLabel(text: "Email")
                    TextField("", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($field, equals: .email)
                        .onSubmit { field = .password }
                        .filledField()
                }
                VStack(spacing: 8) {
                    FieldLabel(text: "Password")
                    SecureField("", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($field, equals: .password)
                        .onSubmit(signIn)
                        .filledField()
                    Button("Forgot your password?") { webPage = server.appending(path: "forgot-password") }
                        .font(.app(.footnote, weight: .medium))
                        .foregroundStyle(Theme.link)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error {
                    Text(error)
                        .font(.app(.footnote))
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: signIn) {
                    if busy { ProgressView().tint(Theme.onAccent) } else { Text("Log In") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty)

                HStack(spacing: 4) {
                    Text("Need an account?").foregroundStyle(Theme.muted)
                    Button("Register") {
                        // Open sign-up happens here; invite-only servers need the invite link.
                        if instance?.signUp?.open == true { registering = true } else { webPage = server.appending(path: "register") }
                    }
                        .foregroundStyle(Theme.link)
                }
                .font(.app(.footnote, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.chat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            instance = try? await APIClient.instance(at: server)
            branding = instance?.server
        }
        .navigationDestination(isPresented: $registering) {
            RegisterView(server: server, branding: branding, challenge: instance?.signUp?.challenge ?? false, onDone: onDone)
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
    }

    private func signIn() {
        error = nil
        busy = true
        Task {
            do {
                try await model.signIn(server: server, email: email.trimmingCharacters(in: .whitespaces), password: password)
                onDone()
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Sign in failed."
            }
            busy = false
        }
    }
}

/// Which server you're signing in to: its icon, name and description as the owner set
/// them, and its address. Servers without a name show their address instead.
struct ServerCard: View {
    let server: URL
    let branding: ServerBranding?
    @ScaledMetric(relativeTo: .headline) private var iconSize: CGFloat = 56

    private var host: String { server.host().map { h in server.port.map { "\(h):\($0)" } ?? h } ?? server.absoluteString }
    private var name: String { branding?.name ?? host }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            AsyncImage(url: branding?.iconUrl.flatMap { URL(string: $0, relativeTo: server)?.absoluteURL }) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Group {
                    if let named = branding?.name {
                        Text(named.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased())
                            .font(.app(.headline))
                    } else {
                        Image(systemName: "bubble.left.and.bubble.right.fill").font(.title3)
                    }
                }
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.accent)
            }
            .frame(width: iconSize, height: iconSize)
            .clipShape(RoundedRectangle(cornerRadius: iconSize * 0.3, style: .continuous))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.app(.headline))
                    .foregroundStyle(Theme.heading)
                if let description = branding?.description {
                    Text(description)
                        .font(.app(.subheadline))
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if branding?.name != nil {
                    Text(host)
                        .font(.app(.caption))
                        .foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.raised, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
