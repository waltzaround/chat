import Foundation

/// One workspace's realtime connection (/ws/workspaces/:id), authenticated with the
/// bearer token. Reconnects with backoff; `onEvent` gets each server event's type and
/// raw JSON, and `onOpen` runs after every (re)connect so callers can resubscribe.
@MainActor
final class RealtimeSocket {
    var onEvent: ((String, Data) -> Void)?
    var onOpen: (() -> Void)?

    private let api: APIClient
    private let workspaceId: String
    private var task: URLSessionWebSocketTask?
    private var closed = false
    private var attempt = 0
    private var heartbeat: Task<Void, Never>?

    init(api: APIClient, workspaceId: String) {
        self.api = api
        self.workspaceId = workspaceId
    }

    func connect() {
        guard !closed, task == nil else { return }
        var components = URLComponents(url: api.server, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/workspaces/\(workspaceId)"
        var request = URLRequest(url: components.url!)
        if let token = api.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        task.resume()
        receive(on: task)
        startHeartbeat()
    }

    func close() {
        closed = true
        heartbeat?.cancel()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    /// Sends a client event such as ["type": "channel.read", "channelId": …, "sequence": …].
    func send(_ event: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: event), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    var isOpen: Bool { task?.state == .running }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case let .success(message):
                    let data: Data? = switch message {
                    case let .string(text): text.data(using: .utf8)
                    case let .data(data): data
                    @unknown default: nil
                    }
                    if let data, let envelope = try? JSONDecoder().decode(Envelope.self, from: data) {
                        if envelope.type == "ready" {
                            self.attempt = 0
                            self.onOpen?()
                        }
                        self.onEvent?(envelope.type, data)
                    }
                    self.receive(on: task)
                case .failure:
                    self.reconnect()
                }
            }
        }
    }

    private func reconnect() {
        task = nil
        heartbeat?.cancel()
        guard !closed else { return }
        attempt += 1
        let delay = min(30.0, 0.5 * pow(2.0, Double(min(attempt, 6))))
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay * Double.random(in: 0.5 ... 1.0)))
            self?.connect()
        }
    }

    private func startHeartbeat() {
        heartbeat?.cancel()
        heartbeat = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                self?.send(["type": "ping"])
            }
        }
    }

    private struct Envelope: Decodable { let type: String }
}
