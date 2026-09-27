package chat.app.android.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

/**
 * One workspace's realtime connection (/ws/workspaces/:id), authenticated with the
 * bearer token. Reconnects with backoff; [onEvent] gets each server event's type and
 * JSON, and [onOpen] runs after every (re)connect so callers can resubscribe.
 * Callbacks arrive on the scope's dispatcher (the main thread for a ViewModel).
 */
class RealtimeSocket(private val api: ApiClient, private val workspaceId: String, private val scope: CoroutineScope) {
    var onEvent: (type: String, data: JsonObject) -> Unit = { _, _ -> }
    var onOpen: () -> Unit = {}

    private var socket: WebSocket? = null
    private var closed = false
    private var attempt = 0
    private var reconnectJob: Job? = null
    var isOpen = false
        private set

    fun connect() {
        if (closed || socket != null) return
        val wsUrl = api.url("/ws/workspaces/$workspaceId").replaceFirst("http", "ws")
        val request = Request.Builder().url(wsUrl).apply { api.token?.let { header("Authorization", "Bearer $it") } }.build()
        socket = ApiClient.http.newWebSocket(request, Listener())
    }

    fun close() {
        closed = true
        reconnectJob?.cancel()
        socket?.close(1000, null)
        socket = null
        isOpen = false
    }

    /** Sends a client event such as {"type":"channel.read", …}. */
    fun send(event: JsonObject) {
        socket?.send(event.toString())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            scope.launch { if (socket === webSocket) isOpen = true }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
            val type = obj["type"]?.jsonPrimitive?.content ?: return
            scope.launch {
                if (socket !== webSocket) return@launch
                if (type == "ready") {
                    attempt = 0
                    onOpen()
                }
                onEvent(type, obj)
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dropped(webSocket)
    }

    private fun dropped(webSocket: WebSocket) {
        scope.launch {
            if (socket !== webSocket) return@launch
            socket = null
            isOpen = false
            if (closed) return@launch
            attempt += 1
            val seconds = min(30.0, 0.5 * 2.0.pow(min(attempt, 6)))
            reconnectJob = scope.launch {
                delay((seconds * Random.nextDouble(0.5, 1.0) * 1000).toLong())
                connect()
            }
        }
    }
}
