import Foundation
import Observation

/// One open channel: its messages (not thread replies), older pages, live updates over
/// the workspace socket, sending, and read tracking.
@MainActor
@Observable
final class ChannelStore {
    private(set) var messages: [Message] = []
    private(set) var pending: [PendingMessage] = []
    private(set) var hasMore = false
    private(set) var loading = true
    private(set) var loadingOlder = false
    var error: String?

    let channelId: String
    private let api: APIClient
    private let socket: RealtimeSocket
    private var lastReadSent = 0
    var onSignedOut: (() -> Void)?

    init(api: APIClient, workspaceId: String, channelId: String) {
        self.api = api
        self.channelId = channelId
        socket = RealtimeSocket(api: api, workspaceId: workspaceId)
        socket.onOpen = { [weak self] in self?.subscribe() }
        socket.onEvent = { [weak self] type, data in self?.handle(type, data) }
    }

    func start() async {
        socket.connect()
        do {
            let page: MessagePage = try await api.get("/api/channels/\(channelId)/messages?limit=50")
            messages = page.messages
            hasMore = page.hasMore
        } catch APIError.signedOut {
            onSignedOut?()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    func stop() {
        socket.close()
    }

    func loadOlder() async {
        guard hasMore, !loadingOlder, let first = messages.first else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        if let page: MessagePage = try? await api.get("/api/channels/\(channelId)/messages?limit=50&before=\(first.sequence)") {
            messages = page.messages + messages.filter { m in !page.messages.contains { $0.id == m.id } }
            hasMore = page.hasMore
        }
    }

    func send(_ text: String, replyTo: String? = nil) {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        let clientId = UUID().uuidString.lowercased()
        pending.append(PendingMessage(id: clientId, content: content, createdAt: .now, replyTo: replyTo))
        if socket.isOpen {
            var event: [String: Any] = ["type": "message.create", "channelId": channelId, "clientMessageId": clientId, "content": content]
            if let replyTo { event["replyTo"] = replyTo }
            socket.send(event)
        } else {
            // No socket yet: the REST fallback does the same thing.
            Task {
                struct Body: Encodable { let content: String; let clientMessageId: String; let replyTo: String? }
                do {
                    let message: Message = try await api.send(api.request("/api/channels/\(channelId)/messages", method: "POST", body: Body(content: content, clientMessageId: clientId, replyTo: replyTo)))
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

    /// Thread replies belong to their thread, not the channel list.
    private func merge(_ message: Message) {
        guard message.threadRootId == nil else { return }
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

    private func fail(_ clientId: String, _ message: String) {
        guard let i = pending.firstIndex(where: { $0.id == clientId }) else { return }
        pending[i].failed = true
        error = message
    }
}
