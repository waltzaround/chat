import SwiftUI

enum Route: Hashable {
    case channel(workspaceId: String, channelId: String, title: String, peer: UserSummary?)
}

/// Signed-in shell: Home (servers, channels, DMs) and You, as tabs like Discord mobile.
struct MainView: View {
    @Environment(AppModel.self) private var model
    @State private var tab = Tab.home
    @State private var path = NavigationPath()
    @State private var webPage: URL?

    enum Tab { case home, you }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $path) {
                HomeView(path: $path)
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case let .channel(workspaceId, channelId, title, peer):
                            ChannelView(workspaceId: workspaceId, channelId: channelId, title: title, peer: peer)
                        }
                    }
            }
            .tint(Theme.heading)
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(Tab.home)

            YouView()
                .tabItem { Label("You", systemImage: "person.crop.circle") }
                .tag(Tab.you)
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .onChange(of: model.pendingLink, initial: true) { _, link in openLink(link) }
        .task { if model.me == nil { await model.loadMe() } }
    }

    /// chat://invite/CODE opens that invite's page on the server.
    private func openLink(_ link: URL?) {
        guard let link, let server = model.server else { return }
        model.pendingLink = nil
        webPage = server.appending(path: "\(link.host() ?? "")\(link.path())")
    }
}
