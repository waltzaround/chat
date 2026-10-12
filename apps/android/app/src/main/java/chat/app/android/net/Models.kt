package chat.app.android.net

import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// Mirrors of the server's JSON (shared/types.ts). Only the fields the app uses.

@Serializable
data class InstanceInfo(val software: String, val version: String, val apiVersion: Int, val server: ServerBranding? = null, val signUp: SignUpInfo? = null)

/** How apps can create accounts on this server. */
@Serializable
data class SignUpInfo(val open: Boolean, val challenge: Boolean, val requireVerifiedEmail: Boolean)

/** The name, description and icon the server's owner set. All optional. */
@Serializable
data class ServerBranding(val name: String? = null, val description: String? = null, val iconUrl: String? = null)

@Serializable
data class UserSummary(val id: String, val username: String, val displayName: String, val avatarUrl: String? = null)

@Serializable
data class CurrentUser(val id: String, val username: String, val displayName: String, val avatarUrl: String? = null, val email: String, val hasPassword: Boolean = true) {
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
    /** An app: a bot, a webhook or an integration like GitHub. Shown with an "APP" badge. */
    val bot: Boolean = false,
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
    /** Rich cards, then link previews. */
    val embeds: List<Embed> = emptyList(),
    /** Rows of buttons from a bot. */
    val components: List<ComponentRow> = emptyList(),
    /** The slash command this message answers: "walt used /deploy". */
    val interaction: MessageInteraction? = null,
    /** Posted by this incoming webhook. */
    val webhookId: String? = null,
    /** Only you see it (a bot's private reply); the server never stores it. */
    val ephemeral: Boolean = false,
)

@Serializable
data class MessageInteraction(val name: String, val user: UserSummary? = null)

/**
 * A rich card from a webhook or bot ("rich"), or a preview of a link in the text ("link").
 * Image URLs are server paths (/api/media?…, /api/files/…) like avatars.
 */
@Serializable
data class Embed(
    val type: String = "rich",
    val title: String? = null,
    val url: String? = null,
    /** Markdown. */
    val description: String? = null,
    /** 0xRRGGBB, drawn as the card's left edge. */
    val color: Long? = null,
    /** ISO-8601, shown in the footer. */
    val timestamp: String? = null,
    val author: EmbedAuthor? = null,
    val footer: EmbedFooter? = null,
    val fields: List<EmbedField> = emptyList(),
    val image: EmbedImage? = null,
    val thumbnail: EmbedThumbnail? = null,
    /** The site a link preview came from. */
    val provider: EmbedProvider? = null,
)

@Serializable
data class EmbedAuthor(val name: String, val url: String? = null, val iconUrl: String? = null)

@Serializable
data class EmbedFooter(val text: String, val iconUrl: String? = null)

/** [value] is Markdown. Inline fields sit side by side, up to three per row. */
@Serializable
data class EmbedField(val name: String, val value: String, val inline: Boolean = false)

@Serializable
data class EmbedImage(val url: String, val width: Double? = null, val height: Double? = null)

@Serializable
data class EmbedThumbnail(val url: String)

@Serializable
data class EmbedProvider(val name: String, val url: String? = null)

/** Up to five buttons side by side (an ActionRow on the server). */
@Serializable
data class ComponentRow(val type: String = "row", val components: List<ButtonComponent> = emptyList())

/** A bot's button. A "link" button opens [url]; the others send [customId] to the bot. */
@Serializable
data class ButtonComponent(
    val type: String = "button",
    /** primary, secondary, success, danger or link. */
    val style: String = "secondary",
    val label: String = "",
    val customId: String? = null,
    val url: String? = null,
    val disabled: Boolean = false,
) {
    val isLink get() = style == "link"
}

/** A command the composer offers after "/". */
@Serializable
data class AvailableCommand(
    val name: String,
    val description: String = "",
    /** Hint shown after the name, e.g. "<environment>". */
    val usage: String? = null,
    /** The bot that answers it, or null for a built-in command. */
    val bot: UserSummary? = null,
)

/** What running a command or pressing a button produced. */
@Serializable
data class InteractionResult(val message: Message? = null, val deferred: Boolean = false)

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
