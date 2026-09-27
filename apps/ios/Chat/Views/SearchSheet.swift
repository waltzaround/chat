import SwiftUI

/// Search a workspace's messages; tapping a result opens its channel.
struct SearchSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let server: URL
    let workspace: WorkspaceSummary
    let open: (SearchResult) -> Void
    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var searched = false
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                    TextField("", text: $query, prompt: Text("Search \(workspace.name)").foregroundStyle(Theme.faint))
                        .foregroundStyle(Theme.heading)
                        .submitLabel(.search)
                        .focused($focused)
                        .onSubmit { Task { await search() } }
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.field))
                Button("Cancel") { dismiss() }.foregroundStyle(Theme.heading)
            }
            .padding(16)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if busy {
                        ProgressView().tint(Theme.muted).frame(maxWidth: .infinity).padding(.top, 32)
                    } else if searched && results.isEmpty {
                        Text("No messages match “\(query)”.").foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.top, 32)
                    }
                    ForEach(results) { result in
                        Button { open(result) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("#\(result.channelName)").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                                HStack(alignment: .top, spacing: 10) {
                                    Avatar(user: UserSummary(id: result.message.author.id, username: result.message.author.username, displayName: result.message.author.name, avatarUrl: result.message.author.avatarUrl), size: 32, server: server)
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            Text(result.message.author.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.heading)
                                            Text(ChatDate.label(result.message.createdAt)).font(.caption2).foregroundStyle(Theme.faint)
                                        }
                                        Text(result.message.content).font(.subheadline).foregroundStyle(Theme.text).lineLimit(3)
                                    }
                                }
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panel))
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.chat.ignoresSafeArea())
        .onAppear { focused = true }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let api = model.api(for: server) else { return }
        busy = true
        defer { busy = false; searched = true }
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        do {
            let response: SearchResponse = try await api.get("/api/workspaces/\(workspace.id)/search?q=\(encoded)")
            results = response.results
        } catch APIError.signedOut {
            model.handleSignedOut(server)
        } catch {
            results = []
        }
    }
}

/// Pick someone to message, from any of your servers.
struct NewMessageSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let open: (AccountDM) -> Void
    @State private var query = ""
    @State private var people: [(server: URL, user: UserSummary)] = []
    @State private var error: String?

    private struct Opened: Decodable { let workspaceId: String; let channelId: String }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(Theme.danger).listRowBackground(Theme.panel) }
                ForEach(people, id: \.user.id) { person in
                    Button { Task { await start(person.server, person.user) } } label: {
                        HStack(spacing: 12) {
                            Avatar(user: person.user, size: 36, server: person.server)
                            VStack(alignment: .leading) {
                                Text(person.user.displayName).foregroundStyle(Theme.heading)
                                Text(model.accounts.count > 1 ? "@\(person.user.username) · \(model.account(for: person.server)?.host ?? "")" : "@\(person.user.username)")
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    .listRowBackground(Theme.panel)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.panel)
            .searchable(text: $query, prompt: "Who do you want to message?")
            .navigationTitle("New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                await findPeople()
            }
        }
    }

    private func findPeople() async {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        var found: [(URL, UserSummary)] = []
        for account in model.accounts {
            if let list: [UserSummary] = try? await account.api.get("/api/dms/people?q=\(q)") {
                found += list.map { (account.server, $0) }
            }
        }
        people = found
    }

    private func start(_ server: URL, _ user: UserSummary) async {
        guard let api = model.api(for: server) else { return }
        do {
            let opened: Opened = try await api.send(api.request("/api/dms", method: "POST", body: ["userId": user.id]))
            let dm = DirectMessage(workspaceId: opened.workspaceId, channelId: opened.channelId, peer: user, lastMessageAt: nil, unreadCount: 0, lastMessage: nil)
            open(AccountDM(server: server, dm: dm))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
