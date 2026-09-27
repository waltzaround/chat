package chat.beacon.android.net

import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// Mirrors of the server's JSON (shared/types.ts). Only the fields the app uses.

@Serializable
data class InstanceInfo(val software: String, val version: String, val apiVersion: Int)

@Serializable
data class UserSummary(val id: String, val username: String, val displayName: String, val avatarUrl: String? = null)

@Serializable
data class CurrentUser(val id: String, val username: String, val displayName: String, val avatarUrl: String? = null, val email: String) {
    val summary get() = UserSummary(id, username, displayName, avatarUrl)
}

@Serializable
data class WorkspaceSummary(val id: String, val name: String, val iconUrl: String? = null, val memberCount: Int, val mentionCount: Int)

@Serializable
data class Category(val id: String, val name: String, val position: Int)

@Serializable
data class Channel(
    val id: String,
    val categoryId: String? = null,
    val name: String,
    val kind: String,
    val position: Int,
    val lastSequence: Int,
    val lastReadSequence: Int,
    val mentionCount: Int,
) {
    val isText get() = kind == "text"
    val isVoice get() = kind == "voice"
    val isUnread get() = lastSequence > lastReadSequence
}

@Serializable
data class WorkspaceDetail(val id: String, val name: String, val categories: List<Category>, val channels: List<Channel>)

@Serializable
data class LastMessage(val authorId: String, val content: String, val hasAttachments: Boolean)

@Serializable
data class DirectMessage(
    val workspaceId: String,
    val channelId: String,
    val peer: UserSummary,
    val lastMessageAt: String? = null,
    val unreadCount: Int,
    val lastMessage: LastMessage? = null,
)

@Serializable
data class MessageAuthor(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val nickname: String? = null,
    val roleColour: String? = null,
) {
    val name get() = nickname ?: displayName
    val summary get() = UserSummary(id, username, name, avatarUrl)
}

@Serializable
data class Attachment(val id: String, val filename: String, val mimeType: String, val width: Int? = null, val height: Int? = null, val url: String) {
    val isImage get() = mimeType.startsWith("image/")
}

@Serializable
data class ReplyContext(val id: String, val author: UserSummary? = null, val content: String, val deleted: Boolean)

@Serializable
data class Reaction(val emoji: String, val count: Int, val me: Boolean)

@Serializable
data class ThreadSummary(val replyCount: Int)

@Serializable
data class Message(
    val id: String,
    val channelId: String,
    val sequence: Int,
    val author: MessageAuthor,
    val content: String,
    val replyTo: ReplyContext? = null,
    val attachments: List<Attachment> = emptyList(),
    val reactions: List<Reaction> = emptyList(),
    val editedAt: String? = null,
    val createdAt: String,
    val threadRootId: String? = null,
    val thread: ThreadSummary? = null,
)

@Serializable
data class MessagePage(val messages: List<Message>, val hasMore: Boolean)

@Serializable
data class SearchResult(val message: Message, val channelName: String)

@Serializable
data class SearchResponse(val results: List<SearchResult>)

@Serializable
data class Invite(val code: String, val url: String)

@Serializable
data class OpenedDm(val workspaceId: String, val channelId: String)

/** A message typed here that the server hasn't confirmed yet. */
data class PendingMessage(val id: String, val content: String, val replyTo: String?, val failed: Boolean = false)

object ChatDate {
    fun parse(iso: String): Instant? = runCatching { Instant.parse(iso) }.getOrNull()

    private val zone get() = ZoneId.systemDefault()
    private val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
    private val dateTime = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    private val longDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)

    fun localDate(iso: String): LocalDate? = parse(iso)?.atZone(zone)?.toLocalDate()

    /** "3:12 PM" today, "Yesterday 3:12 PM", or a date and time. */
    fun label(iso: String): String {
        val at = parse(iso)?.atZone(zone) ?: return ""
        val today = LocalDate.now(zone)
        return when (at.toLocalDate()) {
            today -> at.format(time)
            today.minusDays(1) -> "Yesterday ${at.format(time)}"
            else -> at.format(dateTime)
        }
    }

    /** "now", "5m", "3h", "4d", "2mo", like Discord's DM list. */
    fun relative(iso: String): String {
        val at = parse(iso) ?: return ""
        val s = Duration.between(at, Instant.now()).seconds.coerceAtLeast(0)
        return when {
            s < 60 -> "now"
            s < 3600 -> "${s / 60}m"
            s < 86400 -> "${s / 3600}h"
            s < 86400 * 30 -> "${s / 86400}d"
            s < 86400 * 365 -> "${s / (86400 * 30)}mo"
            else -> "${s / (86400 * 365)}y"
        }
    }

    fun day(date: LocalDate): String = date.format(longDate)
}
