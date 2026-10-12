package chat.app.android.data

import chat.app.android.net.AvailableCommand
import chat.app.android.net.Message
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Messages only you can see (a bot's private replies), by "server|channelId". They live
 * in memory only, so they're gone after a restart, as on the web.
 */
object EphemeralMessages {
    private val _all = MutableStateFlow<Map<String, List<Message>>>(emptyMap())
    val all: StateFlow<Map<String, List<Message>>> = _all.asStateFlow()

    fun key(server: String, channelId: String) = "$server|$channelId"

    /** Adds one; the same message can arrive both as an answer and over the socket. */
    fun add(server: String, message: Message) {
        val key = key(server, message.channelId)
        _all.update { all ->
            val list = all[key].orEmpty()
            all + (key to (if (list.any { it.id == message.id }) list.map { if (it.id == message.id) message else it } else list + message))
        }
    }

    fun dismiss(server: String, channelId: String, messageId: String) {
        val key = key(server, channelId)
        _all.update { all -> all + (key to all[key].orEmpty().filterNot { it.id == messageId }) }
    }
}

/** The slash commands each workspace offers, by "server|workspaceId", fetched once per launch. */
object CommandCache {
    private val cache = mutableMapOf<String, List<AvailableCommand>>()

    operator fun get(server: String, workspaceId: String): List<AvailableCommand>? = synchronized(cache) { cache["$server|$workspaceId"] }

    operator fun set(server: String, workspaceId: String, commands: List<AvailableCommand>) = synchronized(cache) { cache["$server|$workspaceId"] = commands }
}
