package chat.app.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material3.RadioButton
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.rememberCoroutineScope
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.app.android.data.AppState
import chat.app.android.data.ChannelStore
import chat.app.android.net.ApiClient
import chat.app.android.net.ChatDate
import chat.app.android.net.CurrentUser
import chat.app.android.net.Message
import chat.app.android.net.PendingMessage
import chat.app.android.net.Reaction
import java.time.Duration

private val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🎉")

/** A channel or DM: live messages, older history on scroll, and a composer. */
@Composable
fun ChannelScreen(state: AppState, route: ChannelRoute, open: (ChannelRoute) -> Unit, onBack: () -> Unit) {
    val api = state.api(route.server) ?: return onBack()
    val me = state.account(route.server)?.me
    val store = remember(route) { ChannelStore(api, route.workspaceId, route.channelId, route.threadRoot?.id) }
    DisposableEffect(store) { onDispose { store.close() } }
    store.onSignedOut = { state.handleSignedOut(route.server) }
    val ui by store.ui.collectAsState()
    var draft by remember { mutableStateOf("") }
    var replyingTo by remember { mutableStateOf<Message?>(null) }
    var actionsFor by remember { mutableStateOf<Message?>(null) }
    var editing by remember { mutableStateOf<Message?>(null) }
    var reporting by remember { mutableStateOf<Message?>(null) }
    var deleting by remember { mutableStateOf<Message?>(null) }
    var revealed by remember { mutableStateOf(setOf<String>()) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val openThread = { m: Message -> open(route.copy(title = "Thread", peer = null, threadRoot = m, parent = route)) }
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val photo = withContext(Dispatchers.IO) { readPhoto(context, uri) }
            if (photo == null) return@launch
            store.sendImage(photo.bytes, "image/jpeg", photo.width, photo.height, draft, replyingTo?.id)
            draft = ""
            replyingTo = null
        }
    }
    val composer = remember { FocusRequester() }
    val list = rememberLazyListState()

    // Newest at the bottom: the list is reversed so it opens there and stays there.
    val rows = remember(ui.messages, ui.pending) { buildRows(ui.messages, ui.pending, me) }
    LaunchedEffect(ui.messages.lastOrNull()?.id, ui.pending.size) {
        if (list.firstVisibleItemIndex <= 2) list.animateScrollToItem(0)
        store.markRead()
    }
    val nearTop by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 3 } ?: false } }
    LaunchedEffect(nearTop, ui.hasMore) { if (nearTop && ui.hasMore) store.loadOlder() }

    Column(Modifier.fillMaxSize().background(Palette.chat).statusBarsPadding().navigationBarsPadding().imePadding()) {
        // Header
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Palette.heading) }
            when {
                route.peer != null -> Avatar(route.peer, 26.dp, api)
                route.threadRoot != null -> Icon(Icons.Filled.Forum, contentDescription = null, tint = Palette.faint, modifier = Modifier.size(22.dp))
                else -> Icon(Icons.Filled.Tag, contentDescription = null, tint = Palette.faint, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text(route.title, color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
        }
        Divider(color = Palette.rail)

        Box(Modifier.weight(1f)) {
            if (ui.loading) {
                CircularProgressIndicator(color = Palette.muted, modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(state = list, reverseLayout = true, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 8.dp)) {
                    items(rows.size, key = { rows[it].key }) { i ->
                        when (val row = rows[i]) {
                            is Row_.Day -> DaySeparator(row.label)
                            is Row_.Msg -> if (row.message.author.id in ui.blocked && row.message.id !in revealed) {
                                BlockedRow { revealed = revealed + row.message.id }
                            } else {
                                MessageRow(
                                    row.message, row.grouped, me, api,
                                    onLongPress = { actionsFor = row.message },
                                    react = { store.toggleReaction(it, row.message.id) },
                                    openThread = if (route.threadRoot == null) { { openThread(row.message) } } else null,
                                )
                            }
                            is Row_.Pending -> PendingRow(row.pending, me, api, row.grouped) { store.retry(row.pending.id) }
                        }
                    }
                    item(key = "top") {
                        if (ui.hasMore) Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.muted, modifier = Modifier.size(24.dp)) }
                        else if (route.threadRoot != null) Column {
                            MessageRow(route.threadRoot, false, me, api, onLongPress = {}, react = {})
                            DaySeparator("${ui.messages.size} ${if (ui.messages.size == 1) "reply" else "replies"}")
                        }
                        else Welcome(route, api)
                    }
                }
            }
        }

        Composer(
            draft = draft,
            onDraft = { draft = it },
            placeholder = when {
                route.threadRoot != null -> "Reply in thread"
                route.peer != null -> "Message @${route.title}"
                else -> "Message #${route.title}"
            },
            replyingTo = replyingTo,
            editing = editing != null,
            onCancelReply = { replyingTo = null },
            onCancelEdit = { editing = null; draft = "" },
            canAttach = ui.canAttach && editing == null,
            uploading = ui.uploading,
            onAttach = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            focus = composer,
            onSend = {
                val e = editing
                if (e != null) {
                    store.edit(e.id, draft)
                    editing = null
                } else {
                    store.send(draft, replyingTo?.id)
                }
                draft = ""
                replyingTo = null
            },
        )
    }

    actionsFor?.let { message ->
        val mine = message.author.id == me?.id
        MessageActions(
            message,
            mine = mine,
            canDelete = mine || ui.canManage,
            blocked = message.author.id in ui.blocked,
            inThread = route.threadRoot != null,
            onDismiss = { actionsFor = null },
            react = { store.toggleReaction(it, message.id) },
            reply = { replyingTo = message; editing = null; runCatching { composer.requestFocus() } },
            edit = { editing = message; replyingTo = null; draft = message.content; runCatching { composer.requestFocus() } },
            thread = { openThread(message) },
            report = { reporting = message },
            block = { store.setBlocked(message.author.id, message.author.id !in ui.blocked) },
            delete = { deleting = message },
        )
    }
    reporting?.let { message ->
        ReportSheet(message.author.name, onDismiss = { reporting = null }) { reason, note ->
            store.report(message.id, reason, note, message.author.name)
            reporting = null
        }
    }
    deleting?.let { message ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete this message?") },
            text = { Text("This can't be undone.") },
            confirmButton = { TextButton(onClick = { store.delete(message.id); deleting = null }) { Text("Delete", color = Palette.danger) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
            containerColor = Palette.panel,
        )
    }
    ui.notice?.let { notice ->
        AlertDialog(
            onDismissRequest = store::clearNotice,
            title = { Text("Reported") },
            text = { Text(notice) },
            confirmButton = { TextButton(onClick = store::clearNotice) { Text("OK") } },
            containerColor = Palette.panel,
        )
    }
    ui.error?.let { error ->
        AlertDialog(
            onDismissRequest = store::clearError,
            title = { Text("Something went wrong") },
            text = { Text(error) },
            confirmButton = { TextButton(onClick = store::clearError) { Text("OK") } },
            containerColor = Palette.panel,
        )
    }
}

// Rows (in reverse order: newest first, for the reversed list)

private sealed interface Row_ {
    val key: String

    data class Day(val label: String) : Row_ {
        override val key get() = "day-$label"
    }

    data class Msg(val message: Message, val grouped: Boolean) : Row_ {
        override val key get() = message.id
    }

    data class Pending(val pending: PendingMessage, val grouped: Boolean) : Row_ {
        override val key get() = "pending-${pending.id}"
    }
}

private fun buildRows(messages: List<Message>, pending: List<PendingMessage>, me: CurrentUser?): List<Row_> {
    val out = mutableListOf<Row_>()
    messages.forEachIndexed { i, m ->
        val prev = messages.getOrNull(i - 1)
        val day = ChatDate.localDate(m.createdAt)
        val prevDay = prev?.let { ChatDate.localDate(it.createdAt) }
        if (day != null && day != prevDay) out += Row_.Day(ChatDate.day(day))
        val grouped = prev != null && day == prevDay && m.replyTo == null && prev.author.id == m.author.id &&
            (ChatDate.parse(prev.createdAt)?.let { a -> ChatDate.parse(m.createdAt)?.let { b -> Duration.between(a, b).seconds < 300 } } ?: false)
        out += Row_.Msg(m, grouped)
    }
    pending.forEachIndexed { i, p ->
        val grouped = i > 0 || messages.lastOrNull()?.author?.id == me?.id
        out += Row_.Pending(p, grouped)
    }
    return out.asReversed()
}

@Composable
private fun DaySeparator(label: String) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(Palette.raised))
        Text(label, color = Palette.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp).semantics { heading() })
        Box(Modifier.weight(1f).height(1.dp).background(Palette.raised))
    }
}

/** Discord's "Welcome to #channel!" header at the very top of the history. */
@Composable
private fun Welcome(route: ChannelRoute, api: ApiClient) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (route.peer != null) {
            Avatar(route.peer, 80.dp, api)
            Text(route.peer.displayName, color = Palette.heading, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text("@${route.peer.username}", color = Palette.text, fontSize = 18.sp)
            Text("This is the beginning of your direct message history with ${route.peer.displayName}.", color = Palette.muted)
        } else {
            Box(Modifier.size(68.dp).background(Palette.raised, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Tag, contentDescription = null, tint = Color.White, modifier = Modifier.size(38.dp))
            }
            Text("Welcome to #${route.title}!", color = Palette.heading, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text("This is the start of the #${route.title} channel.", color = Palette.muted)
        }
    }
}

// Messages

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun MessageRow(message: Message, grouped: Boolean, me: CurrentUser?, api: ApiClient, onLongPress: () -> Unit, react: (String) -> Unit, openThread: (() -> Unit)? = null) {
    val haptics = LocalHapticFeedback.current
    val mentionsMe = remember(message.id, message.content, me?.id) { mentions(message, me) }
    Column(
        Modifier.fillMaxWidth()
            .background(if (mentionsMe) Palette.mention.copy(alpha = 0.08f) else Color.Transparent)
            .combinedClickable(onClick = {}, onLongClickLabel = "Message actions", onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onLongPress()
            })
            .padding(start = 16.dp, end = 16.dp, top = if (grouped) 2.dp else if (message.replyTo != null) 4.dp else 14.dp, bottom = 2.dp),
    ) {
        message.replyTo?.let { reply ->
            Row(Modifier.padding(start = 17.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.width(28.dp).height(10.dp).padding(top = 6.dp).border(width = 2.dp, color = Palette.faint, shape = RoundedCornerShape(topStart = 6.dp)))
                if (reply.deleted) {
                    Text("Original message was deleted", color = Palette.muted, fontSize = 13.sp, fontStyle = FontStyle.Italic)
                } else {
                    reply.author?.let { Avatar(it, 16.dp, api) }
                    Text(reply.author?.displayName ?: "Deleted user", color = Palette.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(reply.content, color = Palette.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (grouped) Spacer(Modifier.width(34.dp)) else Avatar(message.author.summary, 34.dp, api)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!grouped) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(message.author.name, color = parseHex(message.author.roleColour) ?: Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Text(ChatDate.label(message.createdAt), color = Palette.faint, fontSize = 12.sp)
                    }
                }
                if (message.content.isNotEmpty()) MessageBody(message.content, message.editedAt != null)
                message.attachments.filter { it.isImage }.forEach { a ->
                    RemoteImage(
                        a.url,
                        api,
                        Modifier.widthIn(max = 280.dp).heightIn(max = 280.dp).aspectRatio(((a.width ?: 4).toFloat() / (a.height ?: 3).coerceAtLeast(1)).coerceIn(0.4f, 3f)).clip(RoundedCornerShape(8.dp)),
                    ) { Box(Modifier.fillMaxSize().background(Palette.panel)) }
                }
                message.attachments.filterNot { it.isImage }.forEach { a ->
                    Row(Modifier.widthIn(max = 280.dp).background(Palette.panel, RoundedCornerShape(8.dp)).border(1.dp, Palette.rail, RoundedCornerShape(8.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null, tint = Palette.accent)
                        Text(a.filename, color = Palette.link, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (message.reactions.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        message.reactions.forEach { r -> ReactionPill(r) { react(r.emoji) } }
                    }
                }
                message.thread?.takeIf { it.replyCount > 0 }?.let { t ->
                    Row(
                        Modifier.clip(RoundedCornerShape(6.dp)).clickable(enabled = openThread != null, onClickLabel = "Open thread") { openThread?.invoke() },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(Icons.Filled.Forum, contentDescription = null, tint = Palette.link, modifier = Modifier.size(16.dp))
                        Text("${t.replyCount} ${if (t.replyCount == 1) "reply" else "replies"}", color = Palette.link, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** The text, with "> quote" lines drawn with Discord's side bar. */
@Composable
private fun MessageBody(content: String, edited: Boolean) {
    val blocks = remember(content) {
        val out = mutableListOf<Pair<Boolean, String>>()
        for (line in content.split("\n")) {
            val quote = line.startsWith("> ") || line == ">"
            val text = if (quote) line.drop(2) else line
            if (out.isNotEmpty() && out.last().first == quote) out[out.size - 1] = quote to out.last().second + "\n" + text else out += quote to text
        }
        out
    }
    blocks.forEachIndexed { i, (quote, text) ->
        val rendered: AnnotatedString = buildAnnotatedString {
            append(renderMarkdown(text))
            if (edited && i == blocks.lastIndex) withStyle(SpanStyle(color = Palette.faint, fontSize = 11.sp)) { append(" (edited)") }
        }
        if (quote) {
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.width(4.dp).fillMaxHeight().background(Palette.faint, RoundedCornerShape(2.dp)))
                Text(rendered, color = Palette.text, fontSize = 16.sp, lineHeight = 22.sp)
            }
        } else {
            Text(rendered, color = Palette.text, fontSize = 16.sp, lineHeight = 22.sp)
        }
    }
}

private fun mentions(message: Message, me: CurrentUser?): Boolean {
    if (me == null || message.author.id == me.id) return false
    if (message.replyTo?.author?.id == me.id) return true
    val c = message.content
    return "@everyone" in c || "@here" in c || Regex("@${Regex.escape(me.username)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(c)
}

@Composable
private fun ReactionPill(reaction: Reaction, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(8.dp))
            .background(if (reaction.me) Palette.accent.copy(alpha = 0.25f) else Palette.panel)
            .border(1.dp, if (reaction.me) Palette.accent else Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(onClickLabel = if (reaction.me) "Remove reaction" else "React", onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(reaction.emoji, fontSize = 15.sp)
        Text("${reaction.count}", color = if (reaction.me) Palette.heading else Palette.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PendingRow(pending: PendingMessage, me: CurrentUser?, api: ApiClient, grouped: Boolean, retry: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = if (grouped) 2.dp else 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (grouped || me == null) Spacer(Modifier.width(34.dp)) else Avatar(me.summary, 34.dp, api)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!grouped && me != null) Text(me.displayName, color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(pending.content, color = Palette.faint, fontSize = 16.sp)
            if (pending.failed) Text("Message failed to send. Tap to retry.", color = Palette.danger, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clickable(onClick = retry))
        }
    }
}

@Composable
private fun Composer(
    draft: String,
    onDraft: (String) -> Unit,
    placeholder: String,
    replyingTo: Message?,
    editing: Boolean,
    onCancelReply: () -> Unit,
    onCancelEdit: () -> Unit,
    canAttach: Boolean,
    uploading: Boolean,
    onAttach: () -> Unit,
    focus: FocusRequester,
    onSend: () -> Unit,
) {
    val empty = draft.isBlank()
    Column {
        if (editing) {
            Row(Modifier.fillMaxWidth().background(Palette.panel).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Editing message", color = Palette.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.Cancel, contentDescription = "Cancel editing", tint = Palette.muted, modifier = Modifier.size(20.dp).clickable(onClick = onCancelEdit))
            }
        } else replyingTo?.let { m ->
            Row(Modifier.fillMaxWidth().background(Palette.panel).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(buildAnnotatedString {
                    withStyle(SpanStyle(color = Palette.muted)) { append("Replying to ") }
                    withStyle(SpanStyle(color = Palette.text, fontWeight = FontWeight.Bold)) { append(m.author.name) }
                }, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.Cancel, contentDescription = "Cancel reply", tint = Palette.muted, modifier = Modifier.size(20.dp).clickable(onClick = onCancelReply))
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canAttach) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(Palette.raised).clickable(enabled = !uploading, onClickLabel = "Send a photo", onClick = onAttach), contentAlignment = Alignment.Center) {
                    if (uploading) CircularProgressIndicator(color = Palette.muted, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    else Icon(Icons.Filled.Add, contentDescription = "Send a photo", tint = Palette.heading)
                }
            }
            BasicTextField(
                value = draft,
                onValueChange = onDraft,
                maxLines = 6,
                textStyle = TextStyle(color = Palette.heading, fontSize = 16.sp, fontFamily = PublicSans),
                cursorBrush = SolidColor(Palette.accent),
                modifier = Modifier.weight(1f).focusRequester(focus),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).background(Palette.raised, RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 10.dp), contentAlignment = Alignment.CenterStart) {
                        if (draft.isEmpty()) Text(placeholder, color = Palette.faint, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        inner()
                    }
                },
            )
            AnimatedVisibility(!empty, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(Palette.accent).clickable(onClickLabel = "Send", onClick = onSend), contentAlignment = Alignment.Center) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = Palette.onAccent, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

/** Discord's long-press sheet: quick reactions, then message actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageActions(
    message: Message,
    mine: Boolean,
    canDelete: Boolean,
    blocked: Boolean,
    inThread: Boolean,
    onDismiss: () -> Unit,
    react: (String) -> Unit,
    reply: () -> Unit,
    edit: () -> Unit,
    thread: () -> Unit,
    report: () -> Unit,
    block: () -> Unit,
    delete: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val run = { action: () -> Unit -> onDismiss(); action() }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.panel) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                QUICK_REACTIONS.forEach { emoji ->
                    Box(Modifier.size(48.dp).clip(CircleShape).background(Palette.rail).clickable(onClickLabel = "React with $emoji") { react(emoji); onDismiss() }, contentAlignment = Alignment.Center) {
                        Text(emoji, fontSize = fixedSp(24f))
                    }
                }
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.rail)) {
                ActionRow(Icons.AutoMirrored.Filled.Reply, "Reply") { run(reply) }
                if (!inThread) {
                    Divider(Modifier.padding(start = 52.dp), Palette.raised)
                    ActionRow(Icons.Filled.Forum, if (message.thread == null) "Start Thread" else "Open Thread") { run(thread) }
                }
                if (mine && message.content.isNotEmpty()) {
                    Divider(Modifier.padding(start = 52.dp), Palette.raised)
                    ActionRow(Icons.Filled.Edit, "Edit Message") { run(edit) }
                }
                if (message.content.isNotEmpty()) {
                    Divider(Modifier.padding(start = 52.dp), Palette.raised)
                    ActionRow(Icons.Filled.ContentCopy, "Copy Text") { clipboard.setText(AnnotatedString(message.content)); onDismiss() }
                }
            }
            if (!mine || canDelete) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.rail)) {
                    if (!mine) {
                        ActionRow(Icons.Filled.Flag, "Report Message", Palette.danger) { run(report) }
                        Divider(Modifier.padding(start = 52.dp), Palette.raised)
                        ActionRow(Icons.Filled.Block, if (blocked) "Unblock ${message.author.name}" else "Block ${message.author.name}", Palette.danger) { run(block) }
                    }
                    if (canDelete) {
                        if (!mine) Divider(Modifier.padding(start = 52.dp), Palette.raised)
                        ActionRow(Icons.Filled.Delete, "Delete Message", Palette.danger) { run(delete) }
                    }
                }
            }
        }
    }
}

/** Why a message is being reported, and an optional note for the moderators. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportSheet(authorName: String, onDismiss: () -> Unit, submit: (String, String?) -> Unit) {
    val reasons = listOf("spam" to "Spam", "harassment" to "Harassment or bullying", "inappropriate" to "Inappropriate content", "other" to "Something else")
    var reason by remember { mutableStateOf("harassment") }
    var note by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.panel, sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Report Message", color = Palette.heading, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text("What's wrong with this message?", color = Palette.muted, fontSize = 14.sp)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.rail).selectableGroup()) {
                reasons.forEach { (key, label) ->
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = reason == key, role = Role.RadioButton) { reason = key }.heightIn(min = 52.dp).padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label, color = Palette.heading, fontSize = 16.sp, modifier = Modifier.weight(1f))
                        RadioButton(selected = reason == key, onClick = null)
                    }
                }
            }
            Text("The workspace's moderators see your report and the message. $authorName isn't told who reported it.", color = Palette.muted, fontSize = 13.sp)
            FilledField(note, { note = it }, placeholder = "Note for the moderators (optional)")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                TextButton(onClick = { submit(reason, note.trim().ifEmpty { null }) }) { Text("Report", color = Palette.danger, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

/** A collapsed message from someone you blocked. */
@Composable
private fun BlockedRow(reveal: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Icons.Filled.Block, contentDescription = null, tint = Palette.faint, modifier = Modifier.size(16.dp))
        Text("Message from someone you blocked.", color = Palette.faint, fontSize = 13.sp)
        Text("Show", color = Palette.link, fontSize = 13.sp, modifier = Modifier.clickable(onClick = reveal))
    }
}

private class Photo(val bytes: ByteArray, val width: Int, val height: Int)

/** Decodes a picked photo, shrinks it to at most 2048px, and re-encodes it as JPEG. */
private fun readPhoto(context: android.content.Context, uri: android.net.Uri): Photo? = runCatching {
    val source = android.graphics.ImageDecoder.createSource(context.contentResolver, uri)
    val bitmap = android.graphics.ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        val longest = maxOf(info.size.width, info.size.height)
        if (longest > 2048) {
            val scale = 2048f / longest
            decoder.setTargetSize((info.size.width * scale).toInt(), (info.size.height * scale).toInt())
        }
        decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
    }
    val out = java.io.ByteArrayOutputStream()
    bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)
    Photo(out.toByteArray(), bitmap.width, bitmap.height)
}.getOrNull()

@Composable
private fun ActionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Icon(icon, contentDescription = null, tint = tint ?: Palette.muted)
        Text(label, color = tint ?: Palette.heading, fontWeight = FontWeight.Medium, fontSize = 16.sp)
    }
}
