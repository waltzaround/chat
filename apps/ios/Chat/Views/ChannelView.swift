import PhotosUI
import SwiftUI

/// A channel, DM or thread: live messages, older history on scroll, and a composer.
struct ChannelView: View {
    @Environment(AppModel.self) private var model
    let server: URL
    let workspaceId: String
    let channelId: String
    let title: String
    /// The other person, in a DM.
    let peer: UserSummary?
    /// Set when this shows a thread: the message it started from.
    var threadRoot: Message? = nil
    @State private var store: ChannelStore?
    @State private var draft = ""
    @State private var replyingTo: Message?
    @State private var editing: Message?
    @State private var actionsFor: Message?
    @State private var reporting: Message?
    @State private var deleting: Message?
    @State private var revealed: Set<String> = []
    @State private var photo: PhotosPickerItem?
    @State private var notice: String?
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
            ToolbarItem(placement: .topBarLeading) {
                HStack(spacing: 8) {
                    if let peer {
                        Avatar(user: peer, size: 24)
                    } else if threadRoot != nil {
                        Image(systemName: "bubble.left.and.text.bubble.right").font(.callout.weight(.semibold)).foregroundStyle(Theme.faint)
                    } else {
                        Image(systemName: "number").font(.callout.weight(.semibold)).foregroundStyle(Theme.faint)
                    }
                    Text(title).font(.app(.headline)).foregroundStyle(Theme.heading).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .task {
            guard store == nil, let api = model.api(for: server) else { return }
            let s = ChannelStore(api: api, workspaceId: workspaceId, channelId: channelId, threadRootId: threadRoot?.id)
            s.onSignedOut = { model.handleSignedOut(server) }
            store = s
            await s.start()
        }
        .onDisappear { store?.stop() }
        .environment(\.chatServer, server)
    }

    private var placeholder: String {
        if threadRoot != nil { return "Reply in thread" }
        return peer != nil ? "Message @\(title)" : "Message #\(title)"
    }

    private var me: CurrentUser? { model.account(for: server)?.me }

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
                        if let threadRoot {
                            MessageRow(message: threadRoot, grouped: false, me: me, api: model.api(for: server), react: { _ in })
                            DaySeparator(label: "\(store.messages.count) \(store.messages.count == 1 ? "reply" : "replies")")
                        } else {
                            welcome
                        }
                    }
                    ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                        if let day = newDay(store.messages, index) {
                            DaySeparator(date: day)
                        }
                        if store.blocked.contains(message.author.id) && !revealed.contains(message.id) {
                            BlockedRow { revealed.insert(message.id) }.id("blocked-\(message.id)")
                        } else {
                            MessageRow(
                                message: message,
                                grouped: isGrouped(store.messages, index),
                                me: me,
                                api: model.api(for: server),
                                react: { emoji in store.toggleReaction(emoji, on: message.id) },
                                openThread: threadRoot == nil ? { openThread(message) } : nil
                            )
                            .id(message.id)
                            .onLongPressGesture(minimumDuration: 0.35) {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                actionsFor = message
                            }
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
                let mine = message.author.id == me?.id
                MessageActions(
                    message: message,
                    mine: mine,
                    canDelete: mine || store.canManage,
                    blocked: store.blocked.contains(message.author.id),
                    inThread: threadRoot != nil,
                    react: { store.toggleReaction($0, on: message.id) },
                    reply: { replyingTo = message; editing = nil; composing = true },
                    edit: { editing = message; replyingTo = nil; draft = message.content; composing = true },
                    thread: { openThread(message) },
                    report: { reporting = message },
                    block: { store.setBlocked(message.author.id, !store.blocked.contains(message.author.id)) },
                    delete: { deleting = message }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.panel)
            }
            .sheet(item: $reporting) { message in
                ReportSheet(authorName: message.author.name) { reason, note in
                    Task {
                        if await store.report(message.id, reason: reason, note: note) {
                            notice = "Thanks. The moderators will review it. You can also block \(message.author.name) from the message menu."
                        }
                    }
                }
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.panel)
            }
            .confirmationDialog("Delete this message?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let deleting { store.delete(deleting.id) }
                }
            } message: {
                Text("This can't be undone.")
            }
            .alert("Reported", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(notice ?? "")
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
                Text(peer.displayName).font(.app(.title, weight: .bold)).foregroundStyle(Theme.heading)
                Text("@\(peer.username)").font(.app(.title3)).foregroundStyle(Theme.text)
                Text("This is the beginning of your direct message history with \(peer.displayName).")
                    .foregroundStyle(Theme.muted)
            } else {
                Image(systemName: "number")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 68, height: 68)
                    .background(Circle().fill(Theme.raised))
                Text("Welcome to #\(title)!").font(.app(.title, weight: .bold)).foregroundStyle(Theme.heading)
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
            if editing != nil {
                HStack(spacing: 6) {
                    Text("Editing message").foregroundStyle(Theme.muted)
                    Spacer()
                    Button {
                        self.editing = nil
                        draft = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("Cancel editing")
                }
                .font(.app(.footnote))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Theme.panel)
            } else if let replyingTo {
                HStack(spacing: 6) {
                    Text("Replying to ").foregroundStyle(Theme.muted) + Text(replyingTo.author.name).font(.app(.footnote, weight: .bold)).foregroundStyle(Theme.text)
                    Spacer()
                    Button { self.replyingTo = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("Cancel reply")
                }
                .font(.app(.footnote))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Theme.panel)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if store.canAttach && editing == nil {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Group {
                            if store.uploading {
                                ProgressView().tint(Theme.muted)
                            } else {
                                Image(systemName: "plus").font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.heading)
                            }
                        }
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Theme.raised))
                    }
                    .disabled(store.uploading)
                    .accessibilityLabel("Send a photo")
                    .onChange(of: photo) { _, item in
                        guard let item else { return }
                        photo = nil
                        Task { await sendPhoto(item, store) }
                    }
                }
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
                        if let editing {
                            store.edit(editing.id, to: draft)
                            self.editing = nil
                        } else {
                            store.send(draft, replyTo: replyingTo?.id)
                        }
                        draft = ""
                        replyingTo = nil
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.onAccent)
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

    private func openThread(_ message: Message) {
        model.pushRoute = .thread(server: server, workspaceId: workspaceId, channelId: channelId, root: message)
    }

    /// Shrinks the photo to at most 2048px, as JPEG, and sends it with any typed text.
    private func sendPhoto(_ item: PhotosPickerItem, _ store: ChannelStore) async {
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            store.error = "That photo couldn't be read."
            return
        }
        let scale = min(1, 2048 / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { return }
        store.sendImage(jpeg, mimeType: "image/jpeg", width: Int(size.width), height: Int(size.height), text: draft, replyTo: replyingTo?.id)
        draft = ""
        replyingTo = nil
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
    let mine: Bool
    let canDelete: Bool
    let blocked: Bool
    let inThread: Bool
    let react: (String) -> Void
    let reply: () -> Void
    let edit: () -> Void
    let thread: () -> Void
    let report: () -> Void
    let block: () -> Void
    let delete: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack(spacing: 0) {
                    ForEach(["👍", "❤️", "😂", "😮", "😢", "🎉"], id: \.self) { emoji in
                        Button {
                            react(emoji)
                            dismiss()
                        } label: {
                            Text(emoji)
                                .font(.app(size: 26))
                                .frame(width: 48, height: 48)
                                .background(Circle().fill(Theme.rail))
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("React with \(emoji)")
                    }
                }
                group {
                    action("Reply", icon: "arrowshape.turn.up.left.fill", run: reply)
                    if !inThread {
                        divider
                        action(message.thread == nil ? "Start Thread" : "Open Thread", icon: "bubble.left.and.text.bubble.right.fill", run: thread)
                    }
                    if mine && !message.content.isEmpty {
                        divider
                        action("Edit Message", icon: "pencil", run: edit)
                    }
                    if !message.content.isEmpty {
                        divider
                        action("Copy Text", icon: "doc.on.doc.fill") { UIPasteboard.general.string = message.content }
                    }
                }
                if !mine || canDelete {
                    group {
                        if !mine {
                            action("Report Message", icon: "flag.fill", tint: Theme.danger, run: report)
                            divider
                            action(blocked ? "Unblock \(message.author.name)" : "Block \(message.author.name)", icon: "hand.raised.fill", tint: Theme.danger, run: block)
                        }
                        if canDelete {
                            if !mine { divider }
                            action("Delete Message", icon: "trash.fill", tint: Theme.danger, run: delete)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 28)
            .padding(.bottom, 16)
        }
    }

    private var divider: some View {
        Rectangle().fill(Theme.raised).frame(height: 0.5).padding(.leading, 52)
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0, content: content)
            .background(Theme.rail)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func action(_ title: String, icon: String, tint: Color = Theme.heading, run: @escaping () -> Void) -> some View {
        Button {
            dismiss()
            run()
        } label: {
            HStack(spacing: 16) {
                Image(systemName: icon).frame(width: 20).foregroundStyle(tint == Theme.heading ? Theme.muted : tint)
                Text(title).foregroundStyle(tint)
                Spacer()
            }
            .font(.app(.body, weight: .medium))
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChannelRowStyle())
    }
}

/// Why a message is being reported, and an optional note for the moderators.
struct ReportSheet: View {
    @Environment(\.dismiss) private var dismiss
    let authorName: String
    let submit: (String, String?) -> Void
    @State private var reason = "harassment"
    @State private var note = ""

    private let reasons = [("spam", "Spam"), ("harassment", "Harassment or bullying"), ("inappropriate", "Inappropriate content"), ("other", "Something else")]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(reasons, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("What's wrong with this message?")
                } footer: {
                    Text("The workspace's moderators see your report and the message. \(authorName) isn't told who reported it.")
                }
                Section("Note (optional)") {
                    TextField("Anything that helps the moderators", text: $note, axis: .vertical).lineLimit(2 ... 5)
                }
                .listRowBackground(Theme.rail)
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Report Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Report") {
                        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                        submit(reason, trimmed.isEmpty ? nil : trimmed)
                        dismiss()
                    }
                }
            }
        }
    }
}

/// A collapsed message from someone you blocked.
struct BlockedRow: View {
    let reveal: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "hand.raised.fill")
            Text("Message from someone you blocked.")
            Button("Show", action: reveal).foregroundStyle(Theme.link)
        }
        .font(.app(.footnote))
        .foregroundStyle(Theme.faint)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

struct DaySeparator: View {
    let label: String
    init(date: Date) { label = ChatDate.day(date) }
    init(label: String) { self.label = label }
    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(Theme.raised).frame(height: 1)
            Text(label).font(.app(.caption, weight: .semibold)).foregroundStyle(Theme.faint).fixedSize()
            Rectangle().fill(Theme.raised).frame(height: 1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
    }
}
