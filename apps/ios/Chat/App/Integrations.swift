import Foundation
import Observation

/// App-wide, in-memory state for apps (bots): each channel's "only you can see this"
/// messages and each workspace's slash commands. Nothing is saved: ephemeral messages are
/// gone when the app restarts, as they are on the web after a reload.
@MainActor
@Observable
final class Integrations {
    static let shared = Integrations()

    /// Keyed by server and channel.
    private(set) var ephemeralByChannel: [String: [Message]] = [:]
    /// Keyed by server and workspace; missing until first fetched.
    private(set) var commandsByWorkspace: [String: [AvailableCommand]] = [:]
    @ObservationIgnored private var loading: [String: Task<[AvailableCommand], Error>] = [:]

    static func key(_ server: URL, _ id: String) -> String { "\(server.absoluteString)|\(id)" }

    // MARK: - Ephemeral messages

    func ephemeral(_ server: URL, channelId: String) -> [Message] {
        ephemeralByChannel[Self.key(server, channelId)] ?? []
    }

    /// Adds (or replaces) a message only you can see. It arrives both as the answer to your
    /// request and over the socket, so it's matched by id.
    func addEphemeral(_ message: Message, server: URL) {
        let key = Self.key(server, message.channelId)
        var list = ephemeralByChannel[key] ?? []
        if let i = list.firstIndex(where: { $0.id == message.id }) {
            list[i] = message
        } else {
            list.append(message)
        }
        ephemeralByChannel[key] = list
    }

    func dismissEphemeral(_ messageId: String, server: URL, channelId: String) {
        ephemeralByChannel[Self.key(server, channelId)]?.removeAll { $0.id == messageId }
    }

    // MARK: - Slash commands

    /// The workspace's commands, fetched once and then cached. `force` fetches again.
    func commands(api: APIClient, workspaceId: String, force: Bool = false) async throws -> [AvailableCommand] {
        let key = Self.key(api.server, workspaceId)
        if !force, let cached = commandsByWorkspace[key] { return cached }
        if let running = loading[key] { return try await running.value }
        let task = Task { () throws -> [AvailableCommand] in
            let list: LossyArray<AvailableCommand> = try await api.get("/api/workspaces/\(workspaceId)/commands")
            return list.elements
        }
        loading[key] = task
        defer { loading[key] = nil }
        let list = try await task.value
        commandsByWorkspace[key] = list
        return list
    }

    func cachedCommands(_ server: URL, workspaceId: String) -> [AvailableCommand]? {
        commandsByWorkspace[Self.key(server, workspaceId)]
    }
}
