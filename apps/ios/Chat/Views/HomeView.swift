import SwiftUI

/// What the panel beside the rail shows.
enum HomeSelection: Hashable {
    case dms
    case workspace(server: URL, id: String)

    /// For @AppStorage: "dms" or "<server>|<workspace id>".
    var key: String {
        switch self {
        case .dms: "dms"
        case let .workspace(server, id): "\(server.absoluteString)|\(id)"
        }
    }

    init(key: String) {
        let parts = key.split(separator: "|", maxSplits: 1).map(String.init)
        if parts.count == 2, let url = URL(string: parts[0]) {
            self = .workspace(server: url, id: parts[1])
        } else {
            self = .dms
        }
    }
}

/// A DM, with the server it lives on.
struct AccountDM: Identifiable, Hashable {
    let server: URL
    let dm: DirectMessage
    var id: String { "\(server.absoluteString)|\(dm.workspaceId)" }
}

/// Discord's home: the server rail on the left (every server you're signed in to, one
/// group each), and beside it your messages or the selected workspace's channels, with
/// your profile floating at the bottom.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: NavigationPath
    @AppStorage("chat.selection") private var selectionKey = "dms"
    @State private var workspaces: [URL: [WorkspaceSummary]] = [:]
    @State private var dms: [URL: [DirectMessage]] = [:]
    @State private var details: [String: WorkspaceDetail] = [:]
    @State private var lastChannel: [String: String] = [:]
    @State private var loaded = false
    @State private var errors: [URL: String] = [:]
    @State private var addingServer = false
    @State private var profileOpen = false
    @State private var webPage: URL?

    private var selection: HomeSelection { HomeSelection(key: selectionKey) }

    private var allDms: [AccountDM] {
        model.accounts
            .flatMap { account in (dms[account.server] ?? []).map { AccountDM(server: account.server, dm: $0) } }
            .sorted { ($0.dm.lastMessageAt ?? "") > ($1.dm.lastMessageAt ?? "") }
    }

    private var selectedWorkspace: (server: URL, summary: WorkspaceSummary)? {
        guard case let .workspace(server, id) = selection, let ws = workspaces[server]?.first(where: { $0.id == id }) else { return nil }
        return (server, ws)
    }

    /// The account whose profile the pill shows: the open workspace's, else the first.
    private var currentAccount: Account? {
        if case let .workspace(server, _) = selection, let account = model.account(for: server) { return account }
        return model.accounts.first
    }

    var body: some View {
        HStack(spacing: 0) {
            rail
            panel
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.panel)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 20, style: .continuous))
                .ignoresSafeArea(edges: .bottom)
        }
        .background(Theme.rail.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let account = currentAccount {
                ProfilePill(account: account) {
                    profileOpen = true
                } bell: {
                    webPage = account.server.appending(path: "settings/notifications")
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .onAppear { if loaded { Task { await refreshAll() } } }
        .onChange(of: selectionKey) { _, _ in
            if case let .workspace(server, id) = selection { Task { await loadDetail(server, id) } }
        }
        .onChange(of: model.accounts.map(\.server)) { _, _ in Task { await load() } }
        .sheet(isPresented: $addingServer) {
            AddAccountFlow(adding: true) { addingServer = false }
        }
        .sheet(isPresented: $profileOpen) {
            ProfileSheet(selected: currentAccount?.server) { addingServer = true }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.rail)
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
    }

    // MARK: - Rail

    private var rail: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 8) {
                RailItem(label: "Direct messages", selected: selection == .dms, mentions: 0) {
                    selectionKey = HomeSelection.dms.key
                } content: { selected in
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(selected ? Theme.onAccent : Theme.text)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(selected ? Theme.accent : Theme.raised)
                }

                // Unread DMs float to the top, as on Discord.
                ForEach(allDms.filter { $0.dm.unreadCount > 0 }) { item in
                    RailItem(label: "\(item.dm.peer.displayName), \(item.dm.unreadCount) unread", selected: false, mentions: item.dm.unreadCount) {
                        open(item)
                    } content: { _ in
                        Avatar(user: item.dm.peer, size: 48, server: item.server)
                    }
                }

                Capsule().fill(Theme.raised).frame(width: 32, height: 2)

                ForEach(model.accounts) { account in
                    if let error = errors[account.server], workspaces[account.server] == nil {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color(hex: "F0B232")!)
                            .frame(width: 48, height: 48)
                            .background(Circle().fill(Theme.raised))
                            .accessibilityLabel("\(account.host): \(error)")
                    }
                    ForEach(workspaces[account.server] ?? []) { workspace in
                        let item = HomeSelection.workspace(server: account.server, id: workspace.id)
                        RailItem(label: workspace.name, selected: selection == item, mentions: workspace.mentionCount) {
                            selectionKey = item.key
                        } content: { selected in
                            WorkspaceIcon(workspace: workspace, server: account.server, selected: selected)
                        }
                    }
                }

                RailItem(label: "Add a server", selected: false) {
                    addingServer = true
                } content: { _ in
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Color(hex: "23A55A")!)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.raised)
                }
            }
            .padding(.top, 8)
            // Clear of the profile pill.
            .padding(.bottom, 96)
        }
        .frame(width: 76)
        .refreshable { await refreshAll() }
    }

    // MARK: - Panel

    @ViewBuilder
    private var panel: some View {
        if let (server, workspace) = selectedWorkspace {
            let key = "\(server.absoluteString)|\(workspace.id)"
            ChannelListPanel(
                server: server,
                workspace: workspace,
                detail: details[key],
                error: errors[server],
                selectedChannel: lastChannel[key],
                open: { channel in
                    lastChannel[key] = channel.id
                    path.append(Route.channel(server: server, workspaceId: workspace.id, channelId: channel.id, title: channel.name, peer: nil))
                },
                openMessage: { result in
                    path.append(Route.channel(server: server, workspaceId: workspace.id, channelId: result.message.channelId, title: result.channelName, peer: nil))
                },
                refresh: { await loadDetail(server, workspace.id) }
            )
        } else if selection != .dms && !loaded {
            // A workspace was open last time: don't flash the DM list while it loads.
            ProgressView().tint(Theme.muted)
        } else {
            DirectMessagesPanel(items: allDms, loaded: loaded, open: open) { await load() }
        }
    }

    // MARK: - Data

    private func open(_ item: AccountDM) {
        path.append(Route.channel(server: item.server, workspaceId: item.dm.workspaceId, channelId: item.dm.channelId, title: item.dm.peer.displayName, peer: item.dm.peer))
    }

    private func refreshAll() async {
        await load()
        if case let .workspace(server, id) = selection { await loadDetail(server, id) }
    }

    private func load() async {
        await withTaskGroup(of: (URL, Result<([WorkspaceSummary], [DirectMessage]), Error>).self) { group in
            for account in model.accounts {
                let api = account.api
                group.addTask {
                    do {
                        async let w: [WorkspaceSummary] = api.get("/api/me/workspaces")
                        async let d: [DirectMessage] = api.get("/api/dms")
                        return (account.server, .success(try await (w, d)))
                    } catch {
                        return (account.server, .failure(error))
                    }
                }
            }
            for await (server, result) in group {
                switch result {
                case let .success((w, d)):
                    workspaces[server] = w
                    dms[server] = d
                    errors[server] = nil
                case .failure(APIError.signedOut):
                    model.handleSignedOut(server)
                case let .failure(error):
                    errors[server] = error.localizedDescription
                }
            }
        }
        loaded = true
        if case let .workspace(server, id) = selection {
            if selectedWorkspace == nil {
                selectionKey = HomeSelection.dms.key
            } else if details["\(server.absoluteString)|\(id)"] == nil {
                await loadDetail(server, id)
            }
        }
    }

    private func loadDetail(_ server: URL, _ id: String) async {
        guard let api = model.api(for: server) else { return }
        do {
            details["\(server.absoluteString)|\(id)"] = try await api.get("/api/workspaces/\(id)")
        } catch APIError.signedOut {
            model.handleSignedOut(server)
        } catch {
            errors[server] = error.localizedDescription
        }
    }
}

// MARK: - Rail pieces

/// A server icon on the rail: a rounded square that squares up a little when selected,
/// with a white pill beside it.
struct RailItem<Content: View>: View {
    let label: String
    let selected: Bool
    var mentions = 0
    let action: () -> Void
    @ViewBuilder let content: (Bool) -> Content

    var body: some View {
        Button(action: action) {
            content(selected)
                .frame(width: 50, height: 50)
                .clipShape(RoundedRectangle(cornerRadius: selected ? 16 : 18, style: .continuous))
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
    let server: URL
    var selected = false

    var body: some View {
        RemoteImage(path: workspace.iconUrl, api: model.api(for: server)) {
            Text(initials)
                .font(.app(size: 16, weight: .semibold))
                .foregroundStyle(selected ? Theme.onAccent : .white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(selected ? Theme.accent : Theme.raised)
        }
    }

    private var initials: String {
        workspace.name.split(separator: " ").prefix(3).compactMap(\.first).map(String.init).joined()
    }
}

// MARK: - Profile pill

/// Your avatar, name and status floating at the bottom, like Discord's.
struct ProfilePill: View {
    let account: Account
    let open: () -> Void
    let bell: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 12) {
                    if let me = account.me {
                        Avatar(user: UserSummary(id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl), size: 44, server: account.server)
                            .overlay(alignment: .bottomTrailing) {
                                Circle().fill(Color(hex: "23A55A")!).frame(width: 14, height: 14)
                                    .overlay(Circle().stroke(Theme.field, lineWidth: 3))
                                    .offset(x: 2, y: 2)
                            }
                    } else {
                        Circle().fill(Theme.raised).frame(width: 44, height: 44)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(account.me?.displayName ?? " ")
                                .font(.app(.callout, weight: .semibold))
                                .foregroundStyle(Theme.heading)
                                .lineLimit(1)
                            Image(systemName: "chevron.down").font(.caption2.weight(.bold)).foregroundStyle(Theme.muted)
                        }
                        Text("Online").font(.app(.caption)).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(account.me?.displayName ?? "You"), online. Accounts and settings")

            Button(action: bell) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Notification settings")
        }
        .padding(.leading, 8)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.field)
                .shadow(color: .black.opacity(0.4), radius: 12, y: 4)
        )
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.raised.opacity(0.6), lineWidth: 0.5))
    }
}

// MARK: - Channel list

struct ChannelListPanel: View {
    @Environment(AppModel.self) private var model
    let server: URL
    let workspace: WorkspaceSummary
    let detail: WorkspaceDetail?
    let error: String?
    let selectedChannel: String?
    let open: (Channel) -> Void
    let openMessage: (SearchResult) -> Void
    let refresh: () async -> Void
    @State private var collapsed: Set<String> = []
    @State private var searching = false
    @State private var inviteLink: InviteShare?
    @State private var voiceAlert = false
    @State private var webPage: URL?

    private var sections: [(id: String, title: String, channels: [Channel])] {
        guard let detail else { return [] }
        let visible = detail.channels.filter { $0.isText || $0.isVoice }.sorted { $0.position < $1.position }
        var out: [(String, String, [Channel])] = []
        let loose = visible.filter { $0.categoryId == nil }
        if !loose.isEmpty { out.append(("", "", loose)) }
        for category in detail.categories.sorted(by: { $0.position < $1.position }) {
            let channels = visible.filter { $0.categoryId == category.id }
            if !channels.isEmpty { out.append((category.id, category.name, channels)) }
        }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                Rectangle().fill(Theme.raised.opacity(0.6)).frame(height: 1).padding(.horizontal, 16).padding(.top, 16)

                if detail == nil {
                    if let error {
                        Text(error).font(.app(.footnote)).foregroundStyle(Theme.danger).padding(16)
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
                            HStack(spacing: 6) {
                                Text(section.title).font(.app(.subheadline, weight: .semibold))
                                Image(systemName: "chevron.down")
                                    .font(.caption2.weight(.bold))
                                    .rotationEffect(.degrees(collapsed.contains(section.id) ? -90 : 0))
                                Spacer()
                            }
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 16)
                            .padding(.top, 22)
                            .padding(.bottom, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityHint(collapsed.contains(section.id) ? "Expands the category" : "Collapses the category")
                    }
                    ForEach(section.channels) { channel in
                        // A collapsed category still shows its unread channels, as on Discord.
                        if !collapsed.contains(section.id) || channel.isUnread || channel.id == selectedChannel {
                            ChannelRow(channel: channel, selected: channel.id == selectedChannel) {
                                if channel.isVoice { voiceAlert = true } else { open(channel) }
                            }
                        }
                    }
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 110)
        }
        .refreshable { await refresh() }
        .sheet(isPresented: $searching) {
            SearchSheet(server: server, workspace: workspace) { result in
                searching = false
                openMessage(result)
            }
            .presentationBackground(Theme.chat)
        }
        .sheet(item: $inviteLink) { share in
            ShareSheet(items: [share.url]).presentationDetents([.medium])
        }
        .sheet(item: $webPage) { url in SafariView(url: url).ignoresSafeArea() }
        .alert("Voice isn't in the app yet", isPresented: $voiceAlert) {
            Button("Open in browser") { webPage = server.appending(path: "w/\(workspace.id)") }
            Button("OK", role: .cancel) {}
        } message: {
            Text("Join voice channels from Chat on the web or the desktop app for now.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { webPage = server.appending(path: "w/\(workspace.id)/settings") } label: {
                HStack(spacing: 6) {
                    Text(workspace.name)
                        .font(.app(.title3, weight: .bold))
                        .foregroundStyle(Theme.heading)
                        .lineLimit(1)
                    Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Workspace settings")

            HStack(spacing: 10) {
                Button { searching = true } label: {
                    Label("Search", systemImage: "magnifyingglass")
                        .font(.app(.callout, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.field))
                }
                .buttonStyle(.plain)
                CircleButton(icon: "person.fill.badge.plus", label: "Invite people") { Task { await createInvite() } }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    private func createInvite() async {
        do {
            let invite: Invite = try await model.api(for: server)!.send(model.api(for: server)!.request("/api/workspaces/\(workspace.id)/invites", method: "POST", body: [String: Int]()))
            if let url = URL(string: invite.url) { inviteLink = InviteShare(url: url) }
        } catch APIError.signedOut {
            model.handleSignedOut(server)
        } catch {
            webPage = server.appending(path: "w/\(workspace.id)")
        }
    }
}

struct InviteShare: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// The square-ish grey buttons beside Search.
struct CircleButton: View {
    let icon: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.heading)
                .frame(width: 44, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.field))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct ChannelRow: View {
    let channel: Channel
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: channel.isVoice ? "speaker.wave.2.fill" : "number")
                    .font(.body.weight(.medium))
                    .foregroundStyle(selected || channel.isUnread ? Theme.heading : Theme.faint)
                    .frame(width: 24)
                Text(channel.name)
                    .font(.app(.body, weight: channel.isUnread || selected ? .semibold : .regular))
                    .foregroundStyle(selected || channel.isUnread ? Theme.heading : Theme.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                CountBadge(count: channel.mentionCount, ring: .clear)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(selected ? Theme.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
        .padding(.horizontal, 8)
        .overlay(alignment: .leading) {
            if channel.isUnread && !selected {
                UnevenRoundedRectangle(bottomTrailingRadius: 4, topTrailingRadius: 4)
                    .fill(Theme.heading)
                    .frame(width: 4, height: 8)
            }
        }
        .accessibilityLabel("\(channel.isVoice ? "Voice channel " : "")\(channel.name)\(channel.isUnread ? ", unread" : "")")
    }
}

struct ChannelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(configuration.isPressed ? Theme.hover : .clear))
    }
}

// MARK: - Direct messages

struct DirectMessagesPanel: View {
    @Environment(AppModel.self) private var model
    let items: [AccountDM]
    let loaded: Bool
    let open: (AccountDM) -> Void
    let refresh: () async -> Void
    @State private var newMessage = false
    @State private var searching = false
    @State private var filter = ""

    private var shown: [AccountDM] {
        let q = filter.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter { $0.dm.peer.displayName.lowercased().contains(q) || $0.dm.peer.username.lowercased().contains(q) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Messages")
                    .font(.app(.title3, weight: .bold))
                    .foregroundStyle(Theme.heading)
                    .padding(.horizontal, 16)
                    .padding(.top, 24)
                    .padding(.bottom, 14)

                HStack(spacing: 10) {
                    if searching {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                            TextField("", text: $filter, prompt: Text("Find a conversation").foregroundStyle(Theme.faint))
                                .foregroundStyle(Theme.heading)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                            Button { filter = ""; searching = false } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                                .accessibilityLabel("Close search")
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.field))
                    } else {
                        CircleButton(icon: "magnifyingglass", label: "Find a conversation") { searching = true }
                        Button { newMessage = true } label: {
                            Label("New Message", systemImage: "square.and.pencil")
                                .font(.app(.callout, weight: .semibold))
                                .foregroundStyle(Theme.heading)
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.field))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

                if !loaded {
                    ProgressView().tint(Theme.muted).frame(maxWidth: .infinity).padding(.top, 40)
                } else if items.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bubble.left.and.bubble.right").font(.largeTitle).foregroundStyle(Theme.faint)
                        Text("No messages yet").font(.app(.headline)).foregroundStyle(Theme.heading)
                        Text("Start a conversation with someone from one of your workspaces.")
                            .font(.app(.footnote))
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(24)
                }

                ForEach(shown) { item in
                    DMRow(item: item, me: model.account(for: item.server)?.me) { open(item) }
                }
            }
            .padding(.bottom, 110)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await refresh() }
        .sheet(isPresented: $newMessage) {
            NewMessageSheet { item in
                newMessage = false
                open(item)
            }
            .presentationBackground(Theme.panel)
        }
    }
}

struct DMRow: View {
    let item: AccountDM
    let me: CurrentUser?
    let action: () -> Void

    private var preview: String {
        guard let last = item.dm.lastMessage else { return "@\(item.dm.peer.username)" }
        let who = last.authorId == me?.id ? "You" : item.dm.peer.displayName
        let text = last.content.isEmpty && last.hasAttachments ? "Sent an attachment" : last.content.replacingOccurrences(of: "\n", with: " ")
        return "\(who): \(text)"
    }

    var body: some View {
        let unread = item.dm.unreadCount > 0
        Button(action: action) {
            HStack(spacing: 12) {
                Avatar(user: item.dm.peer, size: 48, server: item.server)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(item.dm.peer.displayName)
                            .font(.app(.body, weight: unread ? .bold : .medium))
                            .foregroundStyle(unread ? Theme.heading : Theme.text)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if let at = item.dm.lastMessageAt {
                            Text(ChatDate.relative(at)).font(.app(.caption)).foregroundStyle(Theme.muted)
                        }
                    }
                    HStack {
                        Text(preview)
                            .font(.app(.subheadline, weight: unread ? .semibold : .regular))
                            .foregroundStyle(unread ? Theme.text : Theme.muted)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        CountBadge(count: item.dm.unreadCount, ring: .clear)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
    }
}

/// UIKit's share sheet, for invite links.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
