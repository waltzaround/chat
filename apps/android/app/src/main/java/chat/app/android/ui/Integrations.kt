package chat.app.android.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.app.android.net.ApiClient
import chat.app.android.net.AvailableCommand
import chat.app.android.net.ButtonComponent
import chat.app.android.net.ChatDate
import chat.app.android.net.ComponentRow
import chat.app.android.net.Embed
import chat.app.android.net.EmbedField
import chat.app.android.net.MessageInteraction

// What bots, webhooks and link previews add to messages: the APP badge, "used /command",
// cards, buttons, private replies, and the composer's command suggestions.

/** Opens a link from a card or button: web pages in a Custom Tab, server paths on the server. */
fun openLink(context: Context, api: ApiClient, url: String) {
    val target = if (url.startsWith("/")) api.url(url) else url
    if (!target.startsWith("https://") && !target.startsWith("http://")) return
    runCatching { openInBrowser(context, target) }
}

/** Shown after the name of a bot, webhook or integration. */
@Composable
fun AppBadge(modifier: Modifier = Modifier) {
    Text(
        "APP",
        color = Palette.muted,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.5.sp,
        maxLines = 1,
        modifier = modifier
            .background(Palette.raised, RoundedCornerShape(4.dp))
            .padding(horizontal = 5.dp, vertical = 1.dp)
            .clearAndSetSemantics { contentDescription = "App" },
    )
}

/** "walt used /deploy", above a bot's answer, drawn like a reply's context line. */
@Composable
fun InteractionHeader(interaction: MessageInteraction, api: ApiClient) {
    Row(Modifier.padding(start = 17.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.width(28.dp).height(10.dp).padding(top = 6.dp).border(width = 2.dp, color = Palette.faint, shape = RoundedCornerShape(topStart = 6.dp)))
        interaction.user?.let { Avatar(it, 16.dp, api) }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = Palette.text, fontWeight = FontWeight.SemiBold)) { append(interaction.user?.displayName ?: "Someone") }
                append(" used ")
                withStyle(SpanStyle(color = Palette.link, fontWeight = FontWeight.Medium)) { append("/${interaction.name}") }
            },
            color = Palette.muted,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Under a private reply: who can see it, and a way to put it away. */
@Composable
fun EphemeralNote(dismiss: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(Icons.Filled.Visibility, contentDescription = null, tint = Palette.faint, modifier = Modifier.size(14.dp))
        Text("Only you can see this ·", color = Palette.faint, fontSize = 12.sp)
        Text(
            "Dismiss",
            color = Palette.link,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClickLabel = "Dismiss message", role = Role.Button, onClick = dismiss).padding(horizontal = 2.dp, vertical = 4.dp),
        )
    }
}

// Cards

/**
 * A rich card or link preview: a coloured left edge, the site or author, a title that
 * opens its link, Markdown text, fields, a thumbnail, a large image, and a footer.
 */
@Composable
fun EmbedCard(embed: Embed, api: ApiClient) {
    val context = LocalContext.current
    val edge = embed.color?.let { Color(0xFF000000 or (it and 0xFFFFFFL)) } ?: Palette.raised
    val shape = RoundedCornerShape(6.dp)
    Column(
        Modifier.widthIn(max = 520.dp).fillMaxWidth()
            .clip(shape)
            .background(Palette.panel)
            // The edge is drawn rather than laid out: images can't be measured intrinsically.
            .drawBehind { drawRect(edge, size = Size(4.dp.toPx(), size.height)) }
            .padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val hasText = embed.provider != null || embed.author != null || embed.title != null || !embed.description.isNullOrBlank() || embed.fields.isNotEmpty()
        if (hasText || embed.thumbnail != null) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                embed.provider?.let { p ->
                    Text(p.name, color = Palette.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                embed.author?.let { a ->
                    Row(
                        Modifier.clip(RoundedCornerShape(4.dp)).then(if (a.url != null) Modifier.clickable(onClickLabel = "Open link") { openLink(context, api, a.url) } else Modifier),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        a.iconUrl?.let { icon -> RemoteImage(icon, api, Modifier.size(20.dp).clip(CircleShape)) { Box(Modifier.fillMaxSize().background(Palette.raised)) } }
                        Text(a.name, color = Palette.heading, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                embed.title?.let { title ->
                    Text(
                        title,
                        color = if (embed.url != null) Palette.link else Palette.heading,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        lineHeight = 20.sp,
                        modifier = if (embed.url != null) Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClickLabel = "Open link") { openLink(context, api, embed.url) } else Modifier,
                    )
                }
                embed.description?.takeIf { it.isNotBlank() }?.let { MessageBody(it, edited = false, fontSize = 14.sp, lineHeight = 20.sp) }
                EmbedFields(embed.fields)
            }
            embed.thumbnail?.let { t ->
                RemoteImage(t.url, api, Modifier.size(80.dp).clip(RoundedCornerShape(6.dp))) { Box(Modifier.fillMaxSize().background(Palette.raised)) }
            }
        }
        embed.image?.let { image ->
            val ratio = remember(image.width, image.height) {
                val w = image.width ?: 0.0
                val h = image.height ?: 0.0
                (if (w > 0 && h > 0) (w / h).toFloat() else 16f / 9f).coerceIn(0.4f, 3f)
            }
            RemoteImage(image.url, api, Modifier.widthIn(max = 480.dp).heightIn(max = 300.dp).aspectRatio(ratio).clip(RoundedCornerShape(6.dp))) {
                Box(Modifier.fillMaxSize().background(Palette.raised))
            }
        }
        val footer = listOfNotNull(embed.footer?.text?.takeIf { it.isNotBlank() }, embed.timestamp?.let(ChatDate::label)?.takeIf { it.isNotEmpty() })
        if (footer.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                embed.footer?.iconUrl?.let { icon -> RemoteImage(icon, api, Modifier.size(20.dp).clip(CircleShape)) { Box(Modifier.fillMaxSize().background(Palette.raised)) } }
                Text(footer.joinToString(" • "), color = Palette.muted, fontSize = 12.sp)
            }
        }
    }
}

/** Fields in rows: a full-width field on its own, inline ones up to three side by side. */
@Composable
private fun EmbedFields(fields: List<EmbedField>) {
    if (fields.isEmpty()) return
    val rows = remember(fields) {
        buildList<List<EmbedField>> {
            var inline = mutableListOf<EmbedField>()
            for (field in fields) {
                if (field.inline && inline.size < 3) {
                    inline += field
                    continue
                }
                if (inline.isNotEmpty()) add(inline)
                inline = mutableListOf()
                if (field.inline) inline += field else add(listOf(field))
            }
            if (inline.isNotEmpty()) add(inline)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { field ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(field.name, color = Palette.heading, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        MessageBody(field.value, edited = false, fontSize = 14.sp, lineHeight = 20.sp)
                    }
                }
                // Inline fields keep to thirds, so columns line up from row to row.
                if (row.size > 1 && row.size < 3) repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// Buttons

/**
 * A bot's rows of buttons. Link buttons open their page; the others call [press].
 * Buttons on a private reply can't reach their bot (it isn't stored), so they're off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MessageComponents(rows: List<ComponentRow>, api: ApiClient, messageId: String, ephemeral: Boolean, pressing: Set<String>, press: (ButtonComponent) -> Unit) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            val buttons = row.components.filter { it.type == "button" && it.label.isNotEmpty() }
            if (buttons.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                buttons.forEach { button ->
                    val busy = "$messageId|${button.customId}" in pressing
                    val enabled = !button.disabled && !busy && if (button.isLink) button.url != null else button.customId != null && !ephemeral
                    MessageButton(button, enabled = enabled, busy = busy) {
                        if (button.isLink) button.url?.let { openLink(context, api, it) } else press(button)
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageButton(button: ButtonComponent, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    val (background, content) = when (button.style) {
        "primary" -> Palette.accent to Palette.onAccent
        "success" -> Palette.green to Color.White
        "danger" -> Palette.danger to Color.White
        else -> Palette.raised to Palette.heading
    }
    Row(
        Modifier.alpha(if (enabled || busy) 1f else 0.5f)
            .heightIn(min = 36.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = if (button.isLink) "Open link" else null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (busy) CircularProgressIndicator(color = content, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
        Text(button.label, color = content, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (button.isLink) Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = content, modifier = Modifier.size(14.dp))
    }
}

// Composer

/** The commands matching what's typed after "/", shown above the composer. */
@Composable
fun CommandSuggestions(commands: List<AvailableCommand>, api: ApiClient, modifier: Modifier = Modifier, pick: (AvailableCommand) -> Unit) {
    Column(
        modifier.fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.rail, RoundedCornerShape(12.dp))
            .heightIn(max = 260.dp)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 6.dp),
    ) {
        Text("COMMANDS", color = Palette.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp).semantics { heading() })
        commands.forEach { command ->
            Row(
                Modifier.fillMaxWidth().clickable(onClickLabel = "Use /${command.name}") { pick(command) }.heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val bot = command.bot
                if (bot != null) Avatar(bot, 28.dp, api)
                else Box(Modifier.size(28.dp).background(Palette.raised, CircleShape), contentAlignment = Alignment.Center) {
                    Text("/", color = Palette.heading, fontWeight = FontWeight.Bold, fontSize = fixedSp(15f))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = Palette.heading, fontWeight = FontWeight.SemiBold)) { append("/${command.name}") }
                            command.usage?.takeIf { it.isNotBlank() }?.let { withStyle(SpanStyle(color = Palette.muted)) { append(" $it") } }
                        },
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (command.description.isNotBlank()) Text(command.description, color = Palette.muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text(bot?.displayName ?: "Built-in", color = Palette.faint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 110.dp))
            }
        }
    }
}
