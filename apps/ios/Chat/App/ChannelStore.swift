import Foundation
import Observation

/// One open channel (or one thread in it): its messages, older pages, live updates over
/// the workspace socket, sending (text and images), editing, deleting, reporting,
/// blocking, read tracking, and apps: slash commands, buttons and ephemeral messages.
@MainActor
@Observable
final class ChannelStore {
    private(set) var messages: [Message] = []
    private(set) var pending: [PendingMessage] = []
    private(set) var hasMore = false
    private(set) var loading = true
    private(set) var loadingOlder = false
    var error: String?
    /// Your permission bits in this channel (shared/permissions.ts).
    private(set) var permissions = 0
    /// People you've blocked: their messages are collapsed.
    private(set) var blocked: Set<String> = []
    private(set) var uploading = false
    /// Buttons waiting on their bot, as "messageId|customId".
    private(set) var pressing: Set<String> = []

    let workspaceId: String
    let channelId: String
    /// Set when this store shows one thread's replies.
    let threadRootId: String?
    private let api: APIClient
    private let socket: RealtimeSocket
    private var lastReadSent = 0
    var onSignedOut: (() -> Void)?

    init(api: APIClient, workspaceId: String, channelId: String, threadRootId: String? = nil) {
        self.api = api
        self.workspaceId = workspaceId
        self.channelId = channelId
        self.threadRootId = threadRootId
        socket = RealtimeSocket(api: api, workspaceId: workspaceId)
        socket.onOpen = { [weak self] in self?.subscribe() }
        socket.onEvent = { [weak self] type, data in self?.handle(type, data) }
    }

    func start() async {
        socket.connect()
        do {
            let page: MessagePage = try await api.get("/api/channels/\(channelId)/messages?limit=50\(threadQuery)")
            messages = page.messages
            hasMore = page.hasMore
            struct Access: Decodable { let permissions: Int }
            if let access: Access = try? await api.get("/api/channels/\(channelId)") { permissions = access.permissions }
            if let blocks: [UserSummary] = try? await api.get("/api/me/blocks") { blocked = Set(blocks.map(\.id)) }
        } catch APIError.signedOut {
            onSignedOut?()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private var threadQuery: String { threadRootId.map { "&thread=\($0)" } ?? "" }

    var canManage: Bool { permissions & (1 << 4) != 0 || permissions & 1 != 0 }
    var canAttach: Bool { permissions & (1 << 11) != 0 || permissions & 1 != 0 }

    func stop() {
        socket.close()
    }

    func loadOlder() async {
        guard hasMore, !loadingOlder, let first = messages.first else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        if let page: MessagePage = try? await api.get("/api/channels/\(channelId)/messages?limit=50&before=\(first.sequence)\(threadQuery)") {
            messages = page.messages + messages.filter { m in !page.messages.contains { $0.id == m.id } }
            hasMore = page.hasMore
        }
    }

    func send(_ text: String, replyTo: String? = nil, attachmentIds: [String] = []) {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !attachmentIds.isEmpty else { return }
        let clientId = UUID().uuidString.lowercased()
        pending.append(PendingMessage(id: clientId, content: content.isEmpty ? "Sending image…" : content, createdAt: .now, replyTo: replyTo))
        if socket.isOpen {
            var event: [String: Any] = ["type": "message.create", "channelId": channelId, "clientMessageId": clientId, "content": content]
            if let replyTo { event["replyTo"] = replyTo }
            if let threadRootId { event["threadRootId"] = threadRootId }
            if !attachmentIds.isEmpty { event["attachmentIds"] = attachmentIds }
            socket.send(event)
        } else {
            // No socket yet: the REST fallback does the same thing.
            Task {
                struct Body: Encodable { let content: String; let clientMessageId: String; let replyTo: String?; let threadRootId: String?; let attachmentIds: [String]? }
                do {
                    let body = Body(content: content, clientMessageId: clientId, replyTo: replyTo, threadRootId: threadRootId, attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds)
                    let message: Message = try await api.send(api.request("/api/channels/\(channelId)/messages", method: "POST", body: body))
                    confirm(message, clientId: clientId)
                } catch {
                    fail(clientId, error.localizedDescription)
                }
            }
        }
    }

    func retry(_ pendingId: String) {
        guard let p = pending.first(where: { $0.id == pendingId }) else { return }
        pending.removeAll { $0.id == pendingId }
        send(p.content, replyTo: p.replyTo)
    }

    /// Called when the newest message is on screen.
    func markRead() {
        guard let newest = messages.last?.sequence, newest > lastReadSent else { return }
        lastReadSent = newest
        socket.send(["type": "channel.read", "channelId": channelId, "sequence": newest])
    }

    // MARK: - Realtime

    private func subscribe() {
        var event: [String: Any] = ["type": "channel.subscribe", "channelId": channelId]
        if let highest = messages.last?.sequence { event["sinceSequence"] = highest }
        socket.send(event)
    }

    private struct Created: Decodable { let message: Message; let clientMessageId: String? }
    private struct Updated: Decodable { let message: Message }
    private struct Deleted: Decodable { let channelId: String; let messageId: String }
    private struct Synced: Decodable { let channelId: String; let messages: [Message] }
    private struct Reacted: Decodable { let channelId: String; let messageId: String; let reactions: [Reaction] }
    private struct Failed: Decodable { let message: String; let clientMessageId: String? }
    private struct WorkspaceUpdated: Decodable { let reason: String }

    private func handle(_ type: String, _ data: Data) {
        let decoder = JSONDecoder()
        switch type {
        case "message.created":
            guard let e = try? decoder.decode(Created.self, from: data), e.message.channelId == channelId else { return }
            confirm(e.message, clientId: e.clientMessageId)
        case "message.updated":
            guard let e = try? decoder.decode(Updated.self, from: data), let i = messages.firstIndex(where: { $0.id == e.message.id }) else { return }
            messages[i] = e.message
        case "message.deleted":
            guard let e = try? decoder.decode(Deleted.self, from: data), e.channelId == channelId else { return }
            messages.removeAll { $0.id == e.messageId }
        case "channel.sync":
            guard let e = try? decoder.decode(Synced.self, from: data), e.channelId == channelId else { return }
            for m in e.messages { merge(m) }
        case "reaction.updated":
            guard let e = try? decoder.decode(Reacted.self, from: data), e.channelId == channelId else { return }
            setReactions(e.messageId, e.reactions)
        case "message.ephemeral":
            // Any channel's: kept app-wide, so it's there when that channel is opened.
            guard let e = try? decoder.decode(Updated.self, from: data) else { return }
            Integrations.shared.addEphemeral(e.message, server: api.server)
        case "workspace.updated":
            // Apps were added or removed: their commands may have changed.
            guard let e = try? decoder.decode(WorkspaceUpdated.self, from: data), ["members", "integrations"].contains(e.reason), commands != nil else { return }
            Task { _ = try? await Integrations.shared.commands(api: api, workspaceId: workspaceId, force: true) }
        case "error":
            guard let e = try? decoder.decode(Failed.self, from: data), let clientId = e.clientMessageId else { return }
            fail(clientId, e.message)
        default:
            break
        }
    }

    private func confirm(_ message: Message, clientId: String?) {
        if let clientId { pending.removeAll { $0.id == clientId } }
        merge(message)
    }

    /// Thread replies belong to their thread, not the channel list (and vice versa).
    private func merge(_ message: Message) {
        guard message.threadRootId == threadRootId else { return }
        if let i = messages.firstIndex(where: { $0.id == message.id }) {
            messages[i] = message
        } else {
            messages.append(message)
            messages.sort { $0.sequence < $1.sequence }
        }
    }

    /// Adds or removes your reaction, like tapping a reaction pill.
    func toggleReaction(_ emoji: String, on messageId: String) {
        guard let message = messages.first(where: { $0.id == messageId }) else { return }
        let mine = message.reactions.contains { $0.emoji == emoji && $0.me }
        let base = "/api/channels/\(channelId)/messages/\(messageId)/reactions"
        let request = mine
            ? api.request("\(base)/\(emoji.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? emoji)", method: "DELETE")
            : api.request(base, method: "PUT", body: ["emoji": emoji])
        Task {
            do {
                setReactions(messageId, try await api.send(request, as: [Reaction].self))
            } catch APIError.signedOut {
                onSignedOut?()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func setReactions(_ messageId: String, _ reactions: [Reaction]) {
        guard let i = messages.firstIndex(where: { $0.id == messageId }) else { return }
        messages[i].reactions = reactions
    }

    // MARK: - Editing, moderation, uploads

    func edit(_ messageId: String, to text: String) {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        perform {
            let updated: Message = try await self.api.send(self.api.request("/api/channels/\(self.channelId)/messages/\(messageId)", method: "PATCH", body: ["content": content]))
            self.merge(updated)
        }
    }

    func delete(_ messageId: String) {
        perform {
            try await self.api.raw(self.api.request("/api/channels/\(self.channelId)/messages/\(messageId)", method: "DELETE"))
            self.messages.removeAll { $0.id == messageId }
        }
    }

    /// Sends the message to the workspace's moderators (or, in a DM, the server owner).
    func report(_ messageId: String, reason: String, note: String?) async -> Bool {
        struct Body: Encodable { let reason: String; let note: String? }
        do {
            try await api.raw(api.request("/api/channels/\(channelId)/messages/\(messageId)/report", method: "POST", body: Body(reason: reason, note: note)))
            return true
        } catch APIError.signedOut {
            onSignedOut?()
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func setBlocked(_ userId: String, _ block: Bool) {
        perform {
            try await self.api.raw(self.api.request("/api/me/blocks/\(userId)", method: block ? "PUT" : "DELETE"))
            if block { self.blocked.insert(userId) } else { self.blocked.remove(userId) }
        }
    }

    /// Uploads an image and sends it (with any text) as one message.
    func sendImage(_ data: Data, mimeType: String, width: Int?, height: Int?, text: String, replyTo: String?) {
        uploading = true
        perform {
            defer { self.uploading = false }
            struct Authorize: Encodable { let channelId: String; let filename: String; let mimeType: String; let byteSize: Int; let purpose = "attachment" }
            struct Authorization: Decodable { let attachmentId: String; let uploadUrl: String; let headers: [String: String] }
            struct Complete: Encodable { let attachmentId: String; let width: Int?; let height: Int? }
            let ext = mimeType == "image/png" ? "png" : "jpg"
            let auth: Authorization = try await self.api.send(self.api.request("/api/uploads/authorize", method: "POST", body: Authorize(channelId: self.channelId, filename: "photo.\(ext)", mimeType: mimeType, byteSize: data.count)))
            // Presigned URLs go straight to R2 (no token); the dev fallback is a server path.
            let isServerPath = auth.uploadUrl.hasPrefix("/")
            var put = isServerPath ? self.api.request(auth.uploadUrl, method: "PUT") : URLRequest(url: URL(string: auth.uploadUrl)!)
            put.httpMethod = "PUT"
            put.httpBody = data
            for (k, v) in auth.headers { put.setValue(v, forHTTPHeaderField: k) }
            let (_, response) = try await URLSession.shared.data(for: put)
            guard ((response as? HTTPURLResponse)?.statusCode ?? 500) < 300 else { throw APIError.server(status: 0, message: "The image didn't upload. Try again.") }
            try await self.api.raw(self.api.request("/api/uploads/complete", method: "POST", body: Complete(attachmentId: auth.attachmentId, width: width, height: height)))
            self.send(text, replyTo: replyTo, attachmentIds: [auth.attachmentId])
        }
    }

    // MARK: - Apps: slash commands, buttons, ephemeral messages

    /// This channel's messages only you can see, shown after the others.
    var ephemeral: [Message] { Integrations.shared.ephemeral(api.server, channelId: channelId) }

    func dismissEphemeral(_ messageId: String) {
        Integrations.shared.dismissEphemeral(messageId, server: api.server, channelId: channelId)
    }

    /// The workspace's slash commands; nil until `loadCommands()` has fetched them.
    var commands: [AvailableCommand]? { Integrations.shared.cachedCommands(api.server, workspaceId: workspaceId) }

    /// Fetches the commands once per workspace, when the composer first sees a "/".
    func loadCommands() {
        guard commands == nil else { return }
        Task { _ = try? await Integrations.shared.commands(api: api, workspaceId: workspaceId) }
    }

    /// "/name rest of the text" split into the name and the text.
    static func parseCommand(_ text: String) -> (name: String, text: String)? {
        guard let match = text.wholeMatch(of: #/\/(\S+)(?:\s+([\s\S]*))?/#) else { return nil }
        return (String(match.output.1), String(match.output.2 ?? ""))
    }

    /// Sends the composer's text: runs it when it's a known slash command, and otherwise
    /// posts it as a message. `preferring` is the command picked from the suggestions,
    /// which tells two bots' commands with the same name apart.
    func submit(_ text: String, replyTo: String?, preferring: AvailableCommand? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsed = Self.parseCommand(trimmed) else {
            send(text, replyTo: replyTo)
            return
        }
        Task {
            let name = parsed.name.lowercased()
            let known = (try? await Integrations.shared.commands(api: api, workspaceId: workspaceId)) ?? []
            if let command = preferring?.name == name ? preferring : known.first(where: { $0.name == name }) {
                await run(command, text: parsed.text, typed: trimmed)
            } else {
                send(text, replyTo: replyTo)
            }
        }
    }

    private func run(_ command: AvailableCommand, text: String, typed: String) async {
        struct Body: Encodable { let name: String; let text: String; let botId: String? }
        // Shown like a message on its way until the bot answers.
        let pendingId = "command-\(UUID().uuidString.lowercased())"
        pending.append(PendingMessage(id: pendingId, content: typed, createdAt: .now))
        defer { pending.removeAll { $0.id == pendingId } }
        do {
            let request = api.request("/api/channels/\(channelId)/commands", method: "POST", body: Body(name: command.name, text: text, botId: command.bot?.id))
            apply(try await api.send(request, as: InteractionResult.self))
        } catch APIError.signedOut {
            onSignedOut?()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func isPressing(_ button: ButtonComponent, on message: Message) -> Bool {
        pressing.contains("\(message.id)|\(button.customId ?? "")")
    }

    /// Sends a button press to the bot that posted the message.
    func press(_ button: ButtonComponent, on message: Message) {
        guard let customId = button.customId, !button.isLink, !button.isDisabled, !message.isEphemeral else { return }
        let key = "\(message.id)|\(customId)"
        guard !pressing.contains(key) else { return }
        pressing.insert(key)
        perform {
            defer { self.pressing.remove(key) }
            let request = self.api.request("/api/channels/\(self.channelId)/messages/\(message.id)/buttons", method: "POST", body: ["customId": customId])
            self.apply(try await self.api.send(request, as: InteractionResult.self))
        }
    }

    /// Shows what a command or button answered with. A deferred answer comes later, over the socket.
    private func apply(_ result: InteractionResult) {
        guard let message = result.message else { return }
        if message.isEphemeral {
            Integrations.shared.addEphemeral(message, server: api.server)
        } else if message.channelId == channelId {
            merge(message)
        }
    }

    private func perform(_ work: @escaping @MainActor () async throws -> Void) {
        Task {
            do {
                try await work()
            } catch APIError.signedOut {
                onSignedOut?()
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func fail(_ clientId: String, _ message: String) {
        guard let i = pending.firstIndex(where: { $0.id == clientId }) else { return }
        pending[i].failed = true
        error = message
    }
}
