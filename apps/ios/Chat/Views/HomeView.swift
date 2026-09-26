import SwiftUI

/// Discord's home: the server rail on the left and, beside it, either your direct
/// messages or the selected server's channels.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: NavigationPath
    @AppStorage("chat.selection") private var selection = HomeView.dmSelection
    @State private var workspaces: [WorkspaceSummary] = []
    @State private var dms: [DirectMessage] = []
    @State private var details: [String: WorkspaceDetail] = [:]
    @State private var loaded = false
    @State private var error: String?
    @State private var webPage: URL?

    static let dmSelection = "dms"

    private var selectedWorkspace: WorkspaceSummary? { workspaces.first { $0.id == selection } }

    var body: some View {
        HStack(spacing: 0) {
            rail
            Group {
                if let workspace = selectedWorkspace {
                    ChannelListPanel(workspace: workspace, detail: details[workspace.id], error: error) { channel in
                        path.append(Route.channel(workspaceId: workspace.id, channelId: channel.id, title: channel.name, peer: nil))
                    } refresh: {
                        await loadDetail(workspace.id)
                    }
                } else if selection != Self.dmSelection && !loaded {
                    // A server was open last time: don't flash the DM list while it loads.
                    ProgressView().tint(Theme.muted)
                } else {
                    DirectMessagesPanel(dms: dms, loaded: loaded, error: error) { dm in
                        open(dm)
                    } refresh: {
                        await load()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.panel)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, style: .continuous))
        }
        .background(Theme.rail.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .onAppear { if loaded { Task { await refreshAll() } } }
        .onChange(of: selection) { _, id in
            if id != Self.dmSelection { Task { await loadDetail(id) } }
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
    }

    // MARK: - Rail

    private var rail: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 8) {
                RailItem(label: "Direct messages", selected: selection == Self.dmSelection) {
                    selection = Self.dmSelection
                } content: { selected in
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(selected ? Theme.accent : Theme.raised)
                }

                // Unread DMs float to the top of the rail, as on Discord.
                ForEach(dms.filter { $0.unreadCount > 0 }) { dm in
                    RailItem(label: "\(dm.peer.displayName), \(dm.unreadCount) unread", selected: false, mentions: dm.unreadCount) {
                        open(dm)
                    } content: { _ in
                        Avatar(user: dm.peer, size: 48)
                    }
                }

                Capsule().fill(Theme.raised).frame(width: 32, height: 2)

                ForEach(workspaces) { workspace in
                    RailItem(label: workspace.name, selected: selection == workspace.id, mentions: workspace.mentionCount) {
                        selection = workspace.id
                    } content: { selected in
                        WorkspaceIcon(workspace: workspace, selected: selected)
                    }
                }

                RailItem(label: "Add a server", selected: false) {
                    webPage = model.server
                } content: { _ in
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color(hex: "23A55A")!)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.raised)
                }
            }
            .padding(.vertical, 12)
        }
        .frame(width: 72)
        .refreshable { await refreshAll() }
    }

    // MARK: - Data

    private func open(_ dm: DirectMessage) {
        path.append(Route.channel(workspaceId: dm.workspaceId, channelId: dm.channelId, title: dm.peer.displayName, peer: dm.peer))
    }

    private func refreshAll() async {
        await load()
        if selectedWorkspace != nil { await loadDetail(selection) }
    }

    private func load() async {
        guard let api = model.api else { return }
        do {
            async let w: [WorkspaceSummary] = api.get("/api/me/workspaces")
            async let d: [DirectMessage] = api.get("/api/dms")
            (workspaces, dms) = try await (w, d)
            error = nil
            if selection != Self.dmSelection {
                if selectedWorkspace == nil { selection = Self.dmSelection } else if details[selection] == nil { await loadDetail(selection) }
            }
        } catch APIError.signedOut {
            model.handleSignedOut()
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func loadDetail(_ id: String) async {
        do {
            details[id] = try await model.api?.get("/api/workspaces/\(id)")
            error = nil
        } catch APIError.signedOut {
            model.handleSignedOut()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A server icon on the rail: round until selected, then a rounded square with a pill
/// beside it.
struct RailItem<Content: View>: View {
    let label: String
    let selected: Bool
    var mentions = 0
    let action: () -> Void
    @ViewBuilder let content: (Bool) -> Content

    var body: some View {
        Button(action: action) {
            content(selected)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: selected ? 16 : 24, style: .continuous))
                .overlay(alignment: .bottomTrailing) { CountBadge(count: mentions).offset(x: 6, y: 6) }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(bottomTrailingRadius: 4, topTrailingRadius: 4)
                .fill(Theme.heading)
                .frame(width: 4, height: selected ? 40 : 0)
        }
        .animation(.spring(duration: 0.25), value: selected)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

struct WorkspaceIcon: View {
    @Environment(AppModel.self) private var model
    let workspace: WorkspaceSummary
    var selected = false

    var body: some View {
        RemoteImage(path: workspace.iconUrl, api: model.api) {
            Text(initials)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(selected ? Theme.accent : Theme.raised)
        }
    }

    private var initials: String {
        workspace.name.split(separator: " ").prefix(3).compactMap(\.first).map(String.init).joined()
    }
}

// MARK: - Channel list

struct ChannelListPanel: View {
    let workspace: WorkspaceSummary
    let detail: WorkspaceDetail?
    let error: String?
    let open: (Channel) -> Void
    let refresh: () async -> Void
    @State private var collapsed: Set<String> = []

    private var sections: [(id: String, title: String, channels: [Channel])] {
        guard let detail else { return [] }
        let text = detail.channels.filter(\.isText).sorted { $0.position < $1.position }
        var out: [(String, String, [Channel])] = []
        let loose = text.filter { $0.categoryId == nil }
        if !loose.isEmpty { out.append(("", "", loose)) }
        for category in detail.categories.sorted(by: { $0.position < $1.position }) {
            let channels = text.filter { $0.categoryId == category.id }
            if !channels.isEmpty { out.append((category.id, category.name, channels)) }
        }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(workspace.name)
                        .font(.title3.bold())
                        .foregroundStyle(Theme.heading)
                        .lineLimit(1)
                    Label("\(workspace.memberCount) \(workspace.memberCount == 1 ? "Member" : "Members")", systemImage: "person.2.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 12)

                Rectangle().fill(Theme.rail.opacity(0.6)).frame(height: 1)

                if detail == nil {
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger).padding(16)
                    } else {
                        ProgressView().tint(Theme.muted).frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }

                ForEach(sections, id: \.id) { section in
                    if !section.title.isEmpty {
                        Button {
                            withAnimation(.snappy) {
                                if collapsed.contains(section.id) { collapsed.remove(section.id) } else { collapsed.insert(section.id) }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 10, weight: .bold))
                                    .rotationEffect(.degrees(collapsed.contains(section.id) ? -90 : 0))
                                Text(section.title.uppercased())
                                    .font(.caption.weight(.bold))
                                Spacer()
                            }
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 12)
                            .padding(.top, 18)
                            .padding(.bottom, 4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(collapsed.contains(section.id) ? "Expands the category" : "Collapses the category")
                    }
                    ForEach(section.channels) { channel in
                        // A collapsed category still shows its unread channels, as on Discord.
                        if !collapsed.contains(section.id) || channel.isUnread {
                            ChannelRow(channel: channel) { open(channel) }
                        }
                    }
                }
            }
            .padding(.bottom, 16)
        }
        .refreshable { await refresh() }
    }
}

struct ChannelRow: View {
    let channel: Channel
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "number")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.faint)
                    .frame(width: 22)
                Text(channel.name)
                    .font(.system(size: 16, weight: channel.isUnread ? .semibold : .medium))
                    .foregroundStyle(channel.isUnread ? Theme.heading : Theme.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                CountBadge(count: channel.mentionCount, ring: .clear)
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
        .padding(.horizontal, 8)
        .overlay(alignment: .leading) {
            if channel.isUnread {
                UnevenRoundedRectangle(bottomTrailingRadius: 4, topTrailingRadius: 4)
                    .fill(Theme.heading)
                    .frame(width: 4, height: 8)
            }
        }
        .accessibilityLabel("\(channel.name)\(channel.isUnread ? ", unread" : "")")
    }
}

struct ChannelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: 6).fill(configuration.isPressed ? Theme.hover : .clear))
    }
}

// MARK: - Direct messages

struct DirectMessagesPanel: View {
    let dms: [DirectMessage]
    let loaded: Bool
    let error: String?
    let open: (DirectMessage) -> Void
    let refresh: () async -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Messages")
                    .font(.title3.bold())
                    .foregroundStyle(Theme.heading)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 12)

                Rectangle().fill(Theme.rail.opacity(0.6)).frame(height: 1).padding(.bottom, 8)

                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.danger).padding(16)
                } else if !loaded {
                    ProgressView().tint(Theme.muted).frame(maxWidth: .infinity).padding(.top, 40)
                } else if dms.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 36))
                            .foregroundStyle(Theme.faint)
                        Text("No messages yet")
                            .font(.headline)
                            .foregroundStyle(Theme.heading)
                        Text("Start a conversation from someone's profile in a server.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(24)
                    .padding(.top, 24)
                }

                ForEach(dms) { dm in
                    Button { open(dm) } label: {
                        HStack(spacing: 12) {
                            Avatar(user: dm.peer, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(dm.peer.displayName)
                                    .font(.system(size: 16, weight: dm.unreadCount > 0 ? .bold : .semibold))
                                    .foregroundStyle(dm.unreadCount > 0 ? Theme.heading : Theme.text)
                                    .lineLimit(1)
                                Text(dm.lastMessageAt.map(ChatDate.relative) ?? "@\(dm.peer.username)")
                                    .font(.caption)
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            CountBadge(count: dm.unreadCount, ring: .clear)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(ChannelRowStyle())
                    .padding(.horizontal, 8)
                    .accessibilityLabel("\(dm.peer.displayName)\(dm.unreadCount > 0 ? ", \(dm.unreadCount) unread" : "")")
                }
            }
            .padding(.bottom, 16)
        }
        .refreshable { await refresh() }
    }
}
