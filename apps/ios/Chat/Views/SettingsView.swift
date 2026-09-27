import SafariServices
import SwiftUI

/// Opened from the profile pill: your accounts on each server, and settings.
struct ProfileSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let selected: URL?
    let addServer: () -> Void
    @State private var webPage: URL?
    @State private var confirmSignOut: Account?
    @State private var deletingAccount: Account?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let account = model.account(for: selected ?? model.accounts.first?.server ?? URL(string: "about:blank")!) {
                    profile(account)
                }
                sectionTitle("Your servers")
                group {
                    ForEach(model.accounts) { account in
                        HStack(spacing: 12) {
                            if let me = account.me {
                                Avatar(user: UserSummary(id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl), size: 36, server: account.server)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(account.host).foregroundStyle(Theme.heading)
                                Text(account.me.map { "@\($0.username)" } ?? "").font(.app(.caption)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Button("Log Out") { confirmSignOut = account }
                                .font(.app(.subheadline, weight: .medium))
                                .foregroundStyle(Theme.danger)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 56)
                        Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 64)
                    }
                    row("Add a server", icon: "plus.circle.fill") {
                        dismiss()
                        addServer()
                    }
                }
                if let account = model.account(for: selected ?? model.accounts.first?.server ?? URL(string: "about:blank")!) {
                    sectionTitle("About \(account.host)")
                    group {
                        row("Privacy Policy", icon: "hand.raised.fill", tint: Theme.muted) { webPage = account.server.appending(path: "privacy") }
                        Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 64)
                        row("Terms of Use", icon: "doc.text.fill", tint: Theme.muted) { webPage = account.server.appending(path: "terms") }
                        Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 64)
                        row("Delete Account", icon: "trash.fill", tint: Theme.danger) { deletingAccount = account }
                    }
                }
                Text("Profile, notification and privacy settings open that server's settings page.")
                    .font(.app(.caption))
                    .foregroundStyle(Theme.faint)
                    .padding(.horizontal, 4)
            }
            .padding(16)
        }
        .background(Theme.rail.ignoresSafeArea())
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .sheet(item: $deletingAccount) { account in
            DeleteAccountSheet(account: account)
                .presentationBackground(Theme.panel)
        }
        .confirmationDialog("Log out of \(confirmSignOut?.host ?? "this server")?", isPresented: Binding(get: { confirmSignOut != nil }, set: { if !$0 { confirmSignOut = nil } }), titleVisibility: .visible) {
            Button("Log Out", role: .destructive) {
                if let account = confirmSignOut { Task { await model.signOut(account.server) } }
            }
        }
    }

    private func profile(_ account: Account) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Theme.hover.frame(height: 80)
            VStack(alignment: .leading, spacing: 12) {
                if let me = account.me {
                    Avatar(user: UserSummary(id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl), size: 76, server: account.server)
                        .padding(5)
                        .background(Circle().fill(Theme.panel))
                        .padding(.top, -46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.displayName).font(.app(.title2, weight: .bold)).foregroundStyle(Theme.heading)
                        Text("@\(me.username) · \(account.host)").font(.app(.subheadline)).foregroundStyle(Theme.text)
                    }
                    HStack(spacing: 10) {
                        Button { webPage = account.server.appending(path: "settings") } label: { Label("Edit Profile", systemImage: "pencil") }
                            .buttonStyle(PrimaryButtonStyle())
                        Button { webPage = account.server.appending(path: "settings/notifications") } label: { Image(systemName: "gearshape.fill") }
                            .buttonStyle(SecondaryButtonStyle())
                            .frame(width: 56)
                            .accessibilityLabel("Settings")
                    }
                } else {
                    ProgressView().tint(Theme.muted).frame(maxWidth: .infinity).padding(.vertical, 24)
                }
            }
            .padding(16)
        }
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased()).font(.app(.caption, weight: .bold)).foregroundStyle(Theme.muted).padding(.horizontal, 4).padding(.bottom, -12)
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0, content: content)
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func row(_ title: String, icon: String, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.title3).frame(width: 36).foregroundStyle(tint ?? Color(hex: "23A55A")!)
                Text(title).foregroundStyle(tint == Theme.danger ? Theme.danger : Theme.heading)
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
    }
}

/// Deletes your account on one server, after you type your username (and password).
struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let account: Account
    @State private var username = ""
    @State private var password = ""
    @State private var deleteMessages = false
    @State private var busy = false
    @State private var error: String?

    private var needsPassword: Bool { account.me?.hasPassword ?? true }
    private var ready: Bool { username.trimmingCharacters(in: .whitespaces) == account.me?.username && (!needsPassword || !password.isEmpty) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This permanently deletes your account on \(account.host): your profile, memberships and direct messages. It can't be undone. Your accounts on other servers aren't affected.")
                        .foregroundStyle(Theme.text)
                }
                Section {
                    Toggle("Also delete every message I've sent", isOn: $deleteMessages)
                } footer: {
                    Text("Otherwise your messages stay, shown as from a deleted user.")
                }
                Section("Type your username, \(account.me?.username ?? "")") {
                    TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    if needsPassword {
                        SecureField("Password", text: $password).textContentType(.password)
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button(role: .destructive, action: delete) {
                        HStack {
                            Text("Delete Account")
                            if busy { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(!ready || busy)
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func delete() {
        busy = true
        error = nil
        Task {
            struct Body: Encodable { let confirmUsername: String; let password: String?; let deleteMessages: Bool }
            do {
                let api = account.api
                try await api.raw(api.request("/api/me", method: "DELETE", body: Body(confirmUsername: username.trimmingCharacters(in: .whitespaces), password: needsPassword ? password : nil, deleteMessages: deleteMessages)))
                dismiss()
                model.handleSignedOut(account.server)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't delete the account."
            }
            busy = false
        }
    }
}

/// The server's own web pages (sign-up, password reset, settings) in an in-app browser.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredBarTintColor = UIColor(Theme.panel)
        controller.preferredControlTintColor = .white
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
