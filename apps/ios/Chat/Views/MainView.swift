import SwiftUI

enum Route: Hashable {
    case channel(server: URL, workspaceId: String, channelId: String, title: String, peer: UserSummary?)
    /// One message's thread, opened from its "N replies" link.
    case thread(server: URL, workspaceId: String, channelId: String, root: Message)
}

/// Signed-in shell: the Discord-style home, with channels pushed on top.
struct MainView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var webPage: URL?

    var body: some View {
        NavigationStack(path: $path) {
            HomeView(path: $path)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case let .channel(server, workspaceId, channelId, title, peer):
                        ChannelView(server: server, workspaceId: workspaceId, channelId: channelId, title: title, peer: peer)
                    case let .thread(server, workspaceId, channelId, root):
                        ChannelView(server: server, workspaceId: workspaceId, channelId: channelId, title: "Thread", peer: nil, threadRoot: root)
                    }
                }
        }
        .tint(Theme.heading)
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .onChange(of: model.pendingLink, initial: true) { _, link in openLink(link) }
        .task {
            await model.loadProfiles()
            PushManager.shared.model = model
            PushManager.shared.start()
        }
        .onChange(of: model.accounts.map(\.server)) { _, _ in Task { await PushManager.shared.syncAccounts() } }
        .onChange(of: model.pendingRoute, initial: true) { _, route in
            guard let route else { return }
            model.pendingRoute = nil
            path = NavigationPath()
            path.append(route)
        }
        .onChange(of: model.pushRoute) { _, route in
            guard let route else { return }
            model.pushRoute = nil
            path.append(route)
        }
    }

    /// chat://invite/CODE opens that invite's page on your first server.
    private func openLink(_ link: URL?) {
        guard let link, let server = model.accounts.first?.server else { return }
        model.pendingLink = nil
        webPage = server.appending(path: "\(link.host() ?? "")\(link.path())")
    }
}
