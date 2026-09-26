import SafariServices
import SwiftUI

/// The You tab: your profile card and account actions, like Discord's.
struct YouView: View {
    @Environment(AppModel.self) private var model
    @State private var webPage: URL?
    @State private var confirmSignOut = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                profile
                group {
                    row("Notifications", icon: "bell.fill") { webPage = model.server?.appending(path: "settings") }
                    divider
                    row("Privacy and safety", icon: "shield.fill") { webPage = model.server?.appending(path: "settings") }
                }
                sectionTitle("Server")
                group {
                    HStack(spacing: 12) {
                        Image(systemName: "server.rack").frame(width: 24).foregroundStyle(Theme.muted)
                        Text(model.server?.host() ?? "").foregroundStyle(Theme.text)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 50)
                    divider
                    row("Switch server", icon: "arrow.left.arrow.right") {
                        Task { await model.signOut(); model.forgetServer() }
                    }
                }
                group {
                    row("Log Out", icon: "rectangle.portrait.and.arrow.right", tint: Theme.danger) { confirmSignOut = true }
                }
                Text("Profile, notification and privacy settings open your server's settings page.")
                    .font(.caption)
                    .foregroundStyle(Theme.faint)
                    .padding(.horizontal, 4)
            }
            .padding(16)
        }
        .background(Theme.rail.ignoresSafeArea())
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .confirmationDialog("Log out of \(model.server?.host() ?? "this server")?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Log Out", role: .destructive) { Task { await model.signOut() } }
        }
    }

    private var profile: some View {
        VStack(alignment: .leading, spacing: 0) {
            Theme.accent.frame(height: 96)
            VStack(alignment: .leading, spacing: 12) {
                if let me = model.me {
                    Avatar(user: UserSummary(id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl), size: 80)
                        .padding(5)
                        .background(Circle().fill(Theme.panel))
                        .padding(.top, -48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.displayName).font(.title2.bold()).foregroundStyle(Theme.heading)
                        Text("@\(me.username)").font(.subheadline).foregroundStyle(Theme.text)
                    }
                    Button { webPage = model.server?.appending(path: "settings") } label: {
                        Label("Edit Profile", systemImage: "pencil")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text("EMAIL").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                        Text(me.email).font(.subheadline).foregroundStyle(Theme.text)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Theme.rail))
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
        Text(text.uppercased()).font(.caption.weight(.bold)).foregroundStyle(Theme.muted).padding(.horizontal, 4).padding(.bottom, -12)
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0, content: content)
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var divider: some View {
        Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 52)
    }

    private func row(_ title: String, icon: String, tint: Color = Theme.text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).frame(width: 24).foregroundStyle(tint == Theme.text ? Theme.muted : tint)
                Text(title).foregroundStyle(tint)
                Spacer()
                if tint == Theme.text { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.faint) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
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
