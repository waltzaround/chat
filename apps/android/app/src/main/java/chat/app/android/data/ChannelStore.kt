package chat.app.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import chat.app.android.net.ApiClient
import chat.app.android.net.ApiException
import chat.app.android.net.AvailableCommand
import chat.app.android.net.ButtonComponent
import chat.app.android.net.InteractionResult
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
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.UUID
import chat.app.android.net.UserSummary
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
private data class Access(val permissions: Int)

@Serializable
private data class UploadAuthorization(val attachmentId: String, val uploadUrl: String, val headers: Map<String, String> = emptyMap())

data class ChannelUi(
    val messages: List<Message> = emptyList(),
    val pending: List<PendingMessage> = emptyList(),
    val hasMore: Boolean = false,
    val loading: Boolean = true,
    val error: String? = null,
    /** Your permission bits here (shared/permissions.ts). */
    val permissions: Int = 0,
    /** People you've blocked: their messages are collapsed. */
    val blocked: Set<String> = emptySet(),
    val uploading: Boolean = false,
    /** A one-off confirmation, e.g. after reporting. */
    val notice: String? = null,
    /** Bots' private replies to you here, shown after the messages until dismissed. */
    val ephemeral: List<Message> = emptyList(),
    /** Buttons waiting on their bot, as "messageId|customId". */
    val pressing: Set<String> = emptySet(),
    /** This workspace's slash commands, once fetched. */
    val commands: List<AvailableCommand>? = null,
) {
    val canManage get() = permissions and (1 shl 4) != 0 || permissions and 1 != 0
    val canAttach get() = permissions and (1 shl 11) != 0 || permissions and 1 != 0
}

/** "/deploy production": a command's name and the text after it. */
private val COMMAND = Regex("""^/(\S+)(?:\s+([\s\S]*))?$""")

/**
 * One open channel (or one thread in it): its messages, older pages, live updates over
 * the workspace socket, sending (text and images), editing, deleting, reporting,
 * blocking, reactions, read tracking, and bots' slash commands and buttons.
 */
class ChannelStore(private val api: ApiClient, private val workspaceId: String, private val channelId: String, private val threadRootId: String? = null) {
    private val threadQuery get() = threadRootId?.let { "&thread=$it" } ?: ""
    /** Lives while the channel is on screen; [close] ends it and the socket. */
    private val viewModelScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _ui = MutableStateFlow(ChannelUi())
    val ui: StateFlow<ChannelUi> = _ui.asStateFlow()
    var onSignedOut: () -> Unit = {}

    private val socket = RealtimeSocket(api, workspaceId, viewModelScope)
    private var lastReadSent = 0
    private var loadingOlder = false
    private var commandsLoading: kotlinx.coroutines.Deferred<List<AvailableCommand>?>? = null

    init {
        socket.onOpen = ::subscribe
        socket.onEvent = ::handle
        socket.connect()
        // Private replies aren't in threads: they belong to the channel.
        if (threadRootId == null) viewModelScope.launch {
            val key = EphemeralMessages.key(api.server, channelId)
            EphemeralMessages.all.collect { all -> _ui.update { it.copy(ephemeral = all[key].orEmpty()) } }
        }
        viewModelScope.launch {
            try {
                val page = api.get<MessagePage>("/api/channels/$channelId/messages?limit=50$threadQuery")
                val permissions = runCatching { api.get<Access>("/api/channels/$channelId").permissions }.getOrDefault(0)
                val blocked = runCatching { api.get<List<UserSummary>>("/api/me/blocks").map { it.id }.toSet() }.getOrDefault(emptySet())
                _ui.update { it.copy(messages = page.messages.filter { m -> m.threadRootId == threadRootId }, hasMore = page.hasMore, loading = false, permissions = permissions, blocked = blocked) }
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
            runCatching { api.get<MessagePage>("/api/channels/$channelId/messages?limit=50&before=${first.sequence}$threadQuery") }.onSuccess { page ->
                _ui.update { s ->
                    val known = page.messages.map { it.id }.toSet()
                    s.copy(messages = page.messages.filter { it.threadRootId == threadRootId } + s.messages.filterNot { it.id in known }, hasMore = page.hasMore)
                }
            }
            loadingOlder = false
        }
    }

    fun send(text: String, replyTo: String? = null, attachmentIds: List<String> = emptyList()) {
        val content = text.trim()
        if (content.isEmpty() && attachmentIds.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        _ui.update { it.copy(pending = it.pending + PendingMessage(clientId, content.ifEmpty { "Sending image…" }, replyTo)) }
        val event = buildJsonObject {
            put("clientMessageId", clientId)
            put("content", content)
            replyTo?.let { put("replyTo", it) }
            threadRootId?.let { put("threadRootId", it) }
            if (attachmentIds.isNotEmpty()) put("attachmentIds", JsonArray(attachmentIds.map { JsonPrimitive(it) }))
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

    // Editing, moderation, uploads

    fun edit(messageId: String, text: String) {
        val content = text.trim()
        if (content.isEmpty()) return
        perform { merge(api.send<Message>("/api/channels/$channelId/messages/$messageId", "PATCH", buildJsonObject { put("content", content) })) }
    }

    fun delete(messageId: String) {
        perform {
            api.raw("/api/channels/$channelId/messages/$messageId", "DELETE")
            _ui.update { s -> s.copy(messages = s.messages.filterNot { it.id == messageId }) }
        }
    }

    /** Sends the message to the workspace's moderators (or, in a DM, the server owner). */
    fun report(messageId: String, reason: String, note: String?, authorName: String) {
        perform {
            api.raw("/api/channels/$channelId/messages/$messageId/report", "POST", buildJsonObject { put("reason", reason); note?.let { put("note", it) } }.toString())
            _ui.update { it.copy(notice = "Thanks. The moderators will review it. You can also block $authorName from the message menu.") }
        }
    }

    fun setBlocked(userId: String, block: Boolean) {
        perform {
            api.raw("/api/me/blocks/$userId", if (block) "PUT" else "DELETE")
            _ui.update { it.copy(blocked = if (block) it.blocked + userId else it.blocked - userId) }
        }
    }

    /** Uploads an image and sends it (with any text) as one message. */
    fun sendImage(bytes: ByteArray, mimeType: String, width: Int?, height: Int?, text: String, replyTo: String?) {
        _ui.update { it.copy(uploading = true) }
        perform {
            try {
                val auth = api.send<UploadAuthorization>("/api/uploads/authorize", "POST", buildJsonObject {
                    put("channelId", channelId)
                    put("filename", if (mimeType == "image/png") "photo.png" else "photo.jpg")
                    put("mimeType", mimeType)
                    put("byteSize", bytes.size)
                    put("purpose", "attachment")
                })
                // Presigned URLs go straight to R2 (no token); the dev fallback is a server path.
                val target = if (auth.uploadUrl.startsWith("/")) api.url(auth.uploadUrl) else auth.uploadUrl
                val put = Request.Builder().url(target).put(bytes.toRequestBody(mimeType.toMediaType())).apply {
                    auth.headers.forEach { (k, v) -> header(k, v) }
                    if (auth.uploadUrl.startsWith("/")) api.token?.let { header("Authorization", "Bearer $it") }
                }.build()
                val ok = withContext(Dispatchers.IO) { ApiClient.http.newCall(put).execute().use { it.isSuccessful } }
                if (!ok) throw ApiException.Server(0, "The image didn't upload. Try again.")
                api.raw("/api/uploads/complete", "POST", buildJsonObject {
                    put("attachmentId", auth.attachmentId)
                    width?.let { put("width", it) }
                    height?.let { put("height", it) }
                }.toString())
                send(text, replyTo, listOf(auth.attachmentId))
            } finally {
                _ui.update { it.copy(uploading = false) }
            }
        }
    }

    fun clearNotice() = _ui.update { it.copy(notice = null) }

    // Slash commands and buttons

    /** Commands work in the channel itself; a thread's composer only sends messages. */
    val commandsEnabled get() = threadRootId == null

    /** Fetches this workspace's commands the first time the composer needs them. */
    fun loadCommands() {
        if (!commandsEnabled || _ui.value.commands != null) return
        viewModelScope.launch { commands() }
    }

    /** From the cache, or fetched once; null when they couldn't be loaded. */
    private suspend fun commands(): List<AvailableCommand>? {
        _ui.value.commands?.let { return it }
        CommandCache[api.server, workspaceId]?.let { cached ->
            _ui.update { it.copy(commands = cached) }
            return cached
        }
        val loading = commandsLoading ?: viewModelScope.async {
            try {
                api.get<List<AvailableCommand>>("/api/workspaces/$workspaceId/commands")
            } catch (e: ApiException.Server) {
                // An older server without integrations has no commands.
                if (e.status == 404) emptyList() else null
            } catch (e: ApiException.SignedOut) {
                onSignedOut()
                null
            } catch (e: Exception) {
                null
            }
        }.also { commandsLoading = it }
        val list = loading.await()
        commandsLoading = null
        if (list != null) {
            CommandCache[api.server, workspaceId] = list
            _ui.update { it.copy(commands = list) }
        }
        return list
    }

    /**
     * Sends the composer's text. "/name text" runs the command called name when this
     * workspace has one (preferring [picked], the suggestion tapped, when two bots share
     * a name); anything else is sent as a message.
     */
    fun submit(text: String, replyTo: String?, picked: AvailableCommand? = null) {
        val match = COMMAND.matchEntire(text.trim())
        if (match == null || !commandsEnabled) return send(text, replyTo)
        val name = match.groupValues[1]
        viewModelScope.launch {
            val known = commands().orEmpty().filter { it.name.equals(name, ignoreCase = true) }
            val command = known.firstOrNull { it == picked } ?: known.firstOrNull()
            if (command == null) send(text, replyTo) else runCommand(command, match.groupValues[2].trim(), text.trim())
        }
    }

    /** Runs a command, showing what was typed as pending until the bot answers (up to a few seconds). */
    private fun runCommand(command: AvailableCommand, text: String, typed: String) {
        val pendingId = UUID.randomUUID().toString()
        _ui.update { it.copy(pending = it.pending + PendingMessage(pendingId, typed, null)) }
        perform {
            try {
                deliver(api.send<InteractionResult>("/api/channels/$channelId/commands", "POST", buildJsonObject {
                    put("name", command.name)
                    put("text", text)
                    command.bot?.let { put("botId", it.id) }
                }))
            } finally {
                _ui.update { s -> s.copy(pending = s.pending.filterNot { it.id == pendingId }) }
            }
        }
    }

    /** Link buttons open in the browser; the others go to the bot that posted the message. */
    fun press(message: Message, button: ButtonComponent) {
        val customId = button.customId ?: return
        if (button.isLink || button.disabled || message.ephemeral) return
        val key = "${message.id}|$customId"
        if (key in _ui.value.pressing) return
        _ui.update { it.copy(pressing = it.pressing + key) }
        perform {
            try {
                deliver(api.send<InteractionResult>("/api/channels/${message.channelId}/messages/${message.id}/buttons", "POST", buildJsonObject { put("customId", customId) }))
            } finally {
                _ui.update { it.copy(pressing = it.pressing - key) }
            }
        }
    }

    fun dismissEphemeral(messageId: String) = EphemeralMessages.dismiss(api.server, channelId, messageId)

    /** Shows what a command or button produced now, rather than waiting for the socket. */
    private fun deliver(result: InteractionResult) {
        val message = result.message ?: return
        if (message.ephemeral) EphemeralMessages.add(api.server, message)
        else if (message.channelId == channelId) merge(message)
    }

    private fun perform(work: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                work()
            } catch (e: ApiException.SignedOut) {
                onSignedOut()
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message ?: "Something went wrong.") }
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
            "message.ephemeral" -> {
                val m = runCatching { json.decodeFromJsonElement(Message.serializer(), data["message"] ?: return) }.getOrNull() ?: return
                EphemeralMessages.add(api.server, m.copy(ephemeral = true))
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
        if (message.threadRootId != threadRootId) return
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
