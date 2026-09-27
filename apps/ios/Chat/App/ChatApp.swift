import SwiftUI

@main
struct ChatApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        // Discord-style bars: dark, no "Back" text, white chevron.
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.chat)
        nav.shadowColor = UIColor(Theme.rail)
        nav.titleTextAttributes = [.foregroundColor: UIColor(Theme.heading)]
        let back = UIBarButtonItemAppearance()
        back.normal.titleTextAttributes = [.foregroundColor: UIColor.clear]
        back.highlighted.titleTextAttributes = [.foregroundColor: UIColor.clear]
        nav.backButtonAppearance = back
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(Theme.heading)

        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = UIColor(Theme.rail)
        tabs.shadowColor = .clear
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // chat://invite/CODE: open the invite on the server's web page, where
                // signing up and joining are handled.
                .onOpenURL { url in model.pendingLink = url }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.accounts.isEmpty {
                AddAccountFlow()
            } else {
                MainView()
            }
        }
        .preferredColorScheme(.dark)
        .tint(Theme.accent)
        .animation(.default, value: model.accounts.isEmpty)
    }
}
