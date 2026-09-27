import SwiftUI

enum Route: Hashable {
    case channel(server: URL, workspaceId: String, channelId: String, title: String, peer: UserSummary?)
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
                    }
                }
        }
        .tint(Theme.heading)
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .onChange(of: model.pendingLink, initial: true) { _, link in openLink(link) }
        .task { await model.loadProfiles() }
    }

    /// chat://invite/CODE opens that invite's page on your first server.
    private func openLink(_ link: URL?) {
        guard let link, let server = model.accounts.first?.server else { return }
        model.pendingLink = nil
        webPage = server.appending(path: "\(link.host() ?? "")\(link.path())")
    }
}
