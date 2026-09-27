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
    @FocusState private var field: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("Welcome back!")
                        .font(.title.bold())
                        .foregroundStyle(Theme.heading)
                    Text("We're so excited to see you again!")
                        .foregroundStyle(Theme.muted)
                    if let host = server.host().map({ h in server.port.map { "\(h):\($0)" } ?? h }) {
                        Label(host, systemImage: "server.rack")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Theme.text)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(Theme.raised))
                            .padding(.top, 4)
                    }
                }
                .padding(.top, 16)

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
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Theme.link)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: signIn) {
                    if busy { ProgressView().tint(.white) } else { Text("Log In") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty)

                HStack(spacing: 4) {
                    Text("Need an account?").foregroundStyle(Theme.muted)
                    Button("Register") { webPage = server.appending(path: "register") }
                        .foregroundStyle(Theme.link)
                }
                .font(.footnote.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.chat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
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

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
