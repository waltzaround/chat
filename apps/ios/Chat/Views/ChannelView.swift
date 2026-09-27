import SwiftUI

/// A channel or DM: live messages, older history on scroll, and a composer.
struct ChannelView: View {
    @Environment(AppModel.self) private var model
    let server: URL
    let workspaceId: String
    let channelId: String
    let title: String
    /// The other person, in a DM.
    let peer: UserSummary?
    @State private var store: ChannelStore?
    @State private var draft = ""
    @State private var replyingTo: Message?
    @State private var actionsFor: Message?
    @FocusState private var composing: Bool

    var body: some View {
        Group {
            if let store, !store.loading {
                content(store)
            } else {
                ProgressView().tint(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.chat.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        // Chevron-only back button, as on Discord.
        .toolbarRole(.editor)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(Theme.chat, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    if let peer {
                        Avatar(user: peer, size: 24)
                    } else {
                        Image(systemName: "number").font(.callout.weight(.semibold)).foregroundStyle(Theme.faint)
                    }
                    Text(title).font(.headline).foregroundStyle(Theme.heading).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .task {
            guard store == nil, let api = model.api(for: server) else { return }
            let s = ChannelStore(api: api, workspaceId: workspaceId, channelId: channelId)
            s.onSignedOut = { model.handleSignedOut(server) }
            store = s
            await s.start()
        }
        .onDisappear { store?.stop() }
        .environment(\.chatServer, server)
    }

    private var placeholder: String { peer != nil ? "Message @\(title)" : "Message #\(title)" }

    private func content(_ store: ChannelStore) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if store.hasMore {
                        ProgressView()
                            .tint(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .onAppear { Task { await store.loadOlder() } }
                    } else if !store.loading {
                        welcome
                    }
                    ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                        if let day = newDay(store.messages, index) {
                            DaySeparator(date: day)
                        }
                        MessageRow(
                            message: message,
                            grouped: isGrouped(store.messages, index),
                            me: model.account(for: server)?.me,
                            api: model.api(for: server),
                            react: { emoji in store.toggleReaction(emoji, on: message.id) }
                        )
                        .id(message.id)
                        .onLongPressGesture(minimumDuration: 0.35) {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            actionsFor = message
                        }
                    }
                    ForEach(store.pending) { p in
                        PendingRow(pending: p, me: model.account(for: server)?.me, grouped: store.messages.last?.author.id == model.account(for: server)?.me?.id) { store.retry(p.id) }.id(p.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                        .onAppear { store.markRead() }
                }
                .padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.messages.last?.id) { _, _ in
                scrollToBottom(proxy)
                store.markRead()
            }
            .onChange(of: store.pending.count) { _, _ in scrollToBottom(proxy) }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer(store) }
            .sheet(item: $actionsFor) { message in
                MessageActions(message: message) { emoji in
                    store.toggleReaction(emoji, on: message.id)
                } reply: {
                    replyingTo = message
                    composing = true
                }
                .presentationDetents([.height(message.content.isEmpty ? 220 : 280)])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.panel)
            }
            .alert("Something went wrong", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(store.error ?? "")
            }
        }
    }

    /// Discord's "Welcome to #channel!" header at the very top of the history.
    private var welcome: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let peer {
                Avatar(user: peer, size: 80)
                Text(peer.displayName).font(.title.bold()).foregroundStyle(Theme.heading)
                Text("@\(peer.username)").font(.title3).foregroundStyle(Theme.text)
                Text("This is the beginning of your direct message history with \(peer.displayName).")
                    .foregroundStyle(Theme.muted)
            } else {
                Image(systemName: "number")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 68, height: 68)
                    .background(Circle().fill(Theme.raised))
                Text("Welcome to #\(title)!").font(.title.bold()).foregroundStyle(Theme.heading)
                Text("This is the start of the #\(title) channel.").foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 8)
    }

    private func composer(_ store: ChannelStore) -> some View {
        let empty = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(spacing: 0) {
            if let replyingTo {
                HStack(spacing: 6) {
                    Text("Replying to ").foregroundStyle(Theme.muted) + Text(replyingTo.author.name).bold().foregroundStyle(Theme.text)
                    Spacer()
                    Button { self.replyingTo = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("Cancel reply")
                }
                .font(.footnote)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Theme.panel)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("", text: $draft, prompt: Text(placeholder).foregroundStyle(Theme.faint), axis: .vertical)
                    .lineLimit(1 ... 6)
                    .focused($composing)
                    .foregroundStyle(Theme.heading)
                    .tint(Theme.accent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.raised))
                if !empty {
                    Button {
                        store.send(draft, replyTo: replyingTo?.id)
                        draft = ""
                        replyingTo = nil
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Theme.accent))
                    }
                    .accessibilityLabel("Send")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.snappy(duration: 0.2), value: empty)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.chat)
        }
    }

    /// Waits a frame so new rows are laid out before scrolling to them.
    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(50))
            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }

    /// The date of a message that starts a new day, for the line above it.
    private func newDay(_ messages: [Message], _ index: Int) -> Date? {
        guard let date = ChatDate.parse(messages[index].createdAt) else { return nil }
        guard index > 0, let prev = ChatDate.parse(messages[index - 1].createdAt) else { return date }
        return Calendar.current.isDate(prev, inSameDayAs: date) ? nil : date
    }

    /// Consecutive messages from one person within 5 minutes share a header.
    private func isGrouped(_ messages: [Message], _ index: Int) -> Bool {
        guard index > 0 else { return false }
        let prev = messages[index - 1], m = messages[index]
        guard m.replyTo == nil, prev.author.id == m.author.id, let a = ChatDate.parse(prev.createdAt), let b = ChatDate.parse(m.createdAt) else { return false }
        return b.timeIntervalSince(a) < 300 && Calendar.current.isDate(a, inSameDayAs: b)
    }
}

/// Discord's long-press sheet: quick reactions, then message actions.
struct MessageActions: View {
    @Environment(\.dismiss) private var dismiss
    let message: Message
    let react: (String) -> Void
    let reply: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 0) {
                ForEach(["👍", "❤️", "😂", "😮", "😢", "🎉"], id: \.self) { emoji in
                    Button {
                        react(emoji)
                        dismiss()
                    } label: {
                        Text(emoji)
                            .font(.system(size: 26))
                            .frame(width: 48, height: 48)
                            .background(Circle().fill(Theme.rail))
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("React with \(emoji)")
                }
            }
            VStack(spacing: 0) {
                action("Reply", icon: "arrowshape.turn.up.left.fill") { reply() }
                if !message.content.isEmpty {
                    Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 52)
                    action("Copy Text", icon: "doc.on.doc.fill") { UIPasteboard.general.string = message.content }
                }
            }
            .background(Theme.rail)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 28)
    }

    private func action(_ title: String, icon: String, run: @escaping () -> Void) -> some View {
        Button {
            dismiss()
            run()
        } label: {
            HStack(spacing: 16) {
                Image(systemName: icon).frame(width: 20).foregroundStyle(Theme.muted)
                Text(title).foregroundStyle(Theme.heading)
                Spacer()
            }
            .font(.body.weight(.medium))
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
    }
}

struct DaySeparator: View {
    let date: Date
    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(Theme.raised).frame(height: 1)
            Text(ChatDate.day(date)).font(.caption.weight(.semibold)).foregroundStyle(Theme.faint).fixedSize()
            Rectangle().fill(Theme.raised).frame(height: 1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
    }
}
