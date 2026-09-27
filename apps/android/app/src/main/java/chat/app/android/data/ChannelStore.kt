package chat.app.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import chat.app.android.net.ApiClient
import chat.app.android.net.ApiException
import chat.app.android.net.Message
import chat.app.android.net.MessagePage
import chat.app.android.net.PendingMessage
import chat.app.android.net.Reaction
import chat.app.android.net.RealtimeSocket
import chat.app.android.net.json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.UUID

data class ChannelUi(
    val messages: List<Message> = emptyList(),
    val pending: List<PendingMessage> = emptyList(),
    val hasMore: Boolean = false,
    val loading: Boolean = true,
    val error: String? = null,
)

/**
 * One open channel: its messages (not thread replies), older pages, live updates over
 * the workspace socket, sending, reactions, and read tracking.
 */
class ChannelStore(private val api: ApiClient, workspaceId: String, private val channelId: String) {
    /** Lives while the channel is on screen; [close] ends it and the socket. */
    private val viewModelScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _ui = MutableStateFlow(ChannelUi())
    val ui: StateFlow<ChannelUi> = _ui.asStateFlow()
    var onSignedOut: () -> Unit = {}

    private val socket = RealtimeSocket(api, workspaceId, viewModelScope)
    private var lastReadSent = 0
    private var loadingOlder = false

    init {
        socket.onOpen = ::subscribe
        socket.onEvent = ::handle
        socket.connect()
        viewModelScope.launch {
            try {
                val page = api.get<MessagePage>("/api/channels/$channelId/messages?limit=50")
                _ui.update { it.copy(messages = page.messages.filter { m -> m.threadRootId == null }, hasMore = page.hasMore, loading = false) }
            } catch (e: ApiException.SignedOut) {
                onSignedOut()
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = e.message) }
            }
        }
    }

    fun close() {
        socket.close()
        viewModelScope.cancel()
    }

    fun loadOlder() {
        val first = _ui.value.messages.firstOrNull() ?: return
        if (!_ui.value.hasMore || loadingOlder) return
        loadingOlder = true
        viewModelScope.launch {
            runCatching { api.get<MessagePage>("/api/channels/$channelId/messages?limit=50&before=${first.sequence}") }.onSuccess { page ->
                _ui.update { s ->
                    val known = page.messages.map { it.id }.toSet()
                    s.copy(messages = page.messages.filter { it.threadRootId == null } + s.messages.filterNot { it.id in known }, hasMore = page.hasMore)
                }
            }
            loadingOlder = false
        }
    }

    fun send(text: String, replyTo: String? = null) {
        val content = text.trim()
        if (content.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        _ui.update { it.copy(pending = it.pending + PendingMessage(clientId, content, replyTo)) }
        val event = buildJsonObject {
            put("clientMessageId", clientId)
            put("content", content)
            replyTo?.let { put("replyTo", it) }
        }
        if (socket.isOpen) {
            socket.send(buildJsonObject {
                put("type", "message.create")
                put("channelId", channelId)
                event.forEach { (key, value) -> put(key, value) }
            })
        } else {
            // No socket yet: the REST fallback does the same thing.
            viewModelScope.launch {
                try {
                    confirm(api.send<Message>("/api/channels/$channelId/messages", "POST", event), clientId)
                } catch (e: Exception) {
                    fail(clientId, e.message ?: "Couldn't send.")
                }
            }
        }
    }

    fun retry(pendingId: String) {
        val p = _ui.value.pending.firstOrNull { it.id == pendingId } ?: return
        _ui.update { s -> s.copy(pending = s.pending.filterNot { it.id == pendingId }) }
        send(p.content, p.replyTo)
    }

    /** Adds or removes your reaction, like tapping a reaction pill. */
    fun toggleReaction(emoji: String, messageId: String) {
        val message = _ui.value.messages.firstOrNull { it.id == messageId } ?: return
        val mine = message.reactions.any { it.emoji == emoji && it.me }
        val base = "/api/channels/$channelId/messages/$messageId/reactions"
        viewModelScope.launch {
            try {
                val reactions = if (mine) {
                    api.send<List<Reaction>>("$base/${URLEncoder.encode(emoji, "UTF-8").replace("+", "%20")}", "DELETE")
                } else {
                    api.send<List<Reaction>>(base, "PUT", buildJsonObject { put("emoji", emoji) })
                }
                setReactions(messageId, reactions)
            } catch (e: ApiException.SignedOut) {
                onSignedOut()
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message) }
            }
        }
    }

    /** Called when the newest message is on screen. */
    fun markRead() {
        val newest = _ui.value.messages.lastOrNull()?.sequence ?: return
        if (newest <= lastReadSent) return
        lastReadSent = newest
        socket.send(buildJsonObject {
            put("type", "channel.read")
            put("channelId", channelId)
            put("sequence", newest)
        })
    }

    fun clearError() = _ui.update { it.copy(error = null) }

    // Realtime

    private fun subscribe() {
        socket.send(buildJsonObject {
            put("type", "channel.subscribe")
            put("channelId", channelId)
            _ui.value.messages.lastOrNull()?.let { put("sinceSequence", it.sequence) }
        })
    }

    private fun handle(type: String, data: JsonObject) {
        fun str(key: String) = data[key]?.jsonPrimitive?.content
        when (type) {
            "message.created" -> {
                val m = json.decodeFromJsonElement(Message.serializer(), data["message"] ?: return)
                if (m.channelId == channelId) confirm(m, str("clientMessageId"))
            }
            "message.updated" -> {
                val m = json.decodeFromJsonElement(Message.serializer(), data["message"] ?: return)
                _ui.update { s -> s.copy(messages = s.messages.map { if (it.id == m.id) m else it }) }
            }
            "message.deleted" -> if (str("channelId") == channelId) {
                val id = str("messageId")
                _ui.update { s -> s.copy(messages = s.messages.filterNot { it.id == id }) }
            }
            "channel.sync" -> if (str("channelId") == channelId) {
                val list = json.decodeFromJsonElement(ListSerializer(Message.serializer()), data["messages"] ?: return)
                list.forEach(::merge)
            }
            "reaction.updated" -> if (str("channelId") == channelId) {
                val reactions = json.decodeFromJsonElement(ListSerializer(Reaction.serializer()), data["reactions"]?.jsonArray ?: return)
                setReactions(str("messageId") ?: return, reactions)
            }
            "error" -> str("clientMessageId")?.let { fail(it, str("message") ?: "Couldn't send.") }
        }
    }

    private fun confirm(message: Message, clientId: String?) {
        if (clientId != null) _ui.update { s -> s.copy(pending = s.pending.filterNot { it.id == clientId }) }
        merge(message)
    }

    /** Thread replies belong to their thread, not the channel list. */
    private fun merge(message: Message) {
        if (message.threadRootId != null) return
        _ui.update { s ->
            val list = if (s.messages.any { it.id == message.id }) s.messages.map { if (it.id == message.id) message else it } else (s.messages + message).sortedBy { it.sequence }
            s.copy(messages = list)
        }
    }

    private fun setReactions(messageId: String, reactions: List<Reaction>) {
        _ui.update { s -> s.copy(messages = s.messages.map { if (it.id == messageId) it.copy(reactions = reactions) else it }) }
    }

    private fun fail(clientId: String, message: String) {
        _ui.update { s -> s.copy(pending = s.pending.map { if (it.id == clientId) it.copy(failed = true) else it }, error = message) }
    }
}
