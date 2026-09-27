package chat.beacon.android.ui

import android.content.Intent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PersonAddAlt1
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.beacon.android.data.Account
import chat.beacon.android.data.AccountDm
import chat.beacon.android.data.AppState
import chat.beacon.android.data.HomeModel
import chat.beacon.android.data.Selection
import chat.beacon.android.net.ApiClient
import chat.beacon.android.net.Channel
import chat.beacon.android.net.ChatDate
import chat.beacon.android.net.CurrentUser
import chat.beacon.android.net.Invite
import chat.beacon.android.net.OpenedDm
import chat.beacon.android.net.SearchResponse
import chat.beacon.android.net.SearchResult
import chat.beacon.android.net.UserSummary
import chat.beacon.android.net.WorkspaceDetail
import chat.beacon.android.net.WorkspaceSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** Where to go from home: a channel or DM on one of your servers. */
data class ChannelRoute(val server: String, val workspaceId: String, val channelId: String, val title: String, val peer: UserSummary?)

/**
 * Discord's home: the rail of every workspace you're in (across all your servers), and
 * beside it your messages or the selected workspace's channels, with your profile
 * floating at the bottom.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(state: AppState, home: HomeModel, open: (ChannelRoute) -> Unit) {
    val accounts by state.accounts.collectAsState()
    val ui by home.ui.collectAsState()
    val context = LocalContext.current
    var addingServer by remember { mutableStateOf(false) }
    var profileOpen by remember { mutableStateOf(false) }

    LaunchedEffect(accounts.map { it.server }) {
        state.loadProfiles()
        home.refresh(state)
    }
    // Keep badges fresh while home is showing.
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            home.refresh(state)
        }
    }

    if (addingServer) {
        AddAccountFlow(state, adding = true, onDone = { addingServer = false }, onCancel = { addingServer = false })
        return
    }

    val allDms = accounts.flatMap { a -> ui.dms[a.server].orEmpty().map { AccountDm(a.server, it) } }.sortedByDescending { it.dm.lastMessageAt ?: "" }
    val selection = ui.selection
    val selected = (selection as? Selection.Workspace)?.let { s -> ui.workspaces[s.server]?.firstOrNull { it.id == s.id }?.let { s to it } }
    val current: Account? = (selection as? Selection.Workspace)?.let { state.account(it.server) } ?: accounts.firstOrNull()
    val openDm = { item: AccountDm -> open(ChannelRoute(item.server, item.dm.workspaceId, item.dm.channelId, item.dm.peer.displayName, item.dm.peer)) }

    Box(Modifier.fillMaxSize().background(Palette.rail)) {
        Row(Modifier.fillMaxSize().statusBarsPadding()) {
            Rail(accounts, ui.workspaces, ui.errors, allDms, selection, state, onSelect = { home.select(it, state) }, onOpenDm = openDm, onAdd = { addingServer = true })
            Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(topStart = 20.dp)).background(Palette.panel)) {
                PullToRefreshBox(isRefreshing = false, onRefresh = { home.refresh(state) }) {
                    when {
                        selected != null -> ChannelListPanel(
                            server = selected.first.server,
                            workspace = selected.second,
                            detail = ui.details[selected.first.key],
                            error = ui.errors[selected.first.server],
                            selectedChannel = ui.lastChannel[selected.first.key],
                            api = state.api(selected.first.server),
                            onSignedOut = { state.handleSignedOut(selected.first.server) },
                            open = { channel ->
                                home.rememberChannel(selected.first, channel.id)
                                open(ChannelRoute(selected.first.server, selected.second.id, channel.id, channel.name, null))
                            },
                        )
                        selection is Selection.Workspace && !ui.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.muted) }
                        else -> DirectMessagesPanel(allDms, ui.loaded, state, openDm)
                    }
                }
            }
        }
        current?.let { account ->
            ProfilePill(
                account,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 4.dp),
                onOpen = { profileOpen = true },
                onBell = { openInBrowser(context, "${account.server}/settings/notifications") },
            )
        }
    }

    if (profileOpen) {
        ProfileSheet(state, current?.server, onDismiss = { profileOpen = false }, onAddServer = {
            profileOpen = false
            addingServer = true
        })
    }
}

// Rail

@Composable
private fun Rail(
    accounts: List<Account>,
    workspaces: Map<String, List<WorkspaceSummary>>,
    errors: Map<String, String>,
    dms: List<AccountDm>,
    selection: Selection,
    state: AppState,
    onSelect: (Selection) -> Unit,
    onOpenDm: (AccountDm) -> Unit,
    onAdd: () -> Unit,
) {
    LazyColumn(
        Modifier.width(76.dp).fillMaxHeight(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(top = 8.dp, bottom = 110.dp),
    ) {
        item {
            RailItem("Direct messages", selected = selection == Selection.Dms, onClick = { onSelect(Selection.Dms) }) { sel ->
                Box(Modifier.fillMaxSize().background(if (sel) Palette.accent else Palette.raised), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.ChatBubble, contentDescription = null, tint = if (sel) Color.White else Palette.text, modifier = Modifier.size(24.dp))
                }
            }
        }
        // Unread DMs float to the top, as on Discord.
        items(dms.filter { it.dm.unreadCount > 0 }, key = { "dm-${it.key}" }) { item ->
            RailItem("${item.dm.peer.displayName}, ${item.dm.unreadCount} unread", selected = false, badge = item.dm.unreadCount, onClick = { onOpenDm(item) }) {
                Avatar(item.dm.peer, 50.dp, state.api(item.server))
            }
        }
        item { Box(Modifier.width(32.dp).height(2.dp).background(Palette.raised, RoundedCornerShape(1.dp))) }
        for (account in accounts) {
            if (errors[account.server] != null && workspaces[account.server] == null) {
                item(key = "err-${account.server}") {
                    Box(
                        Modifier.size(50.dp).background(Palette.raised, CircleShape).semantics { contentDescription = "Can't reach ${account.host}" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Warning, contentDescription = null, tint = Palette.mention) }
                }
            }
            items(workspaces[account.server].orEmpty(), key = { "${account.server}|${it.id}" }) { ws ->
                val item = Selection.Workspace(account.server, ws.id)
                RailItem(ws.name, selected = selection == item, badge = ws.mentionCount, onClick = { onSelect(item) }) { sel ->
                    RemoteImage(ws.iconUrl, state.api(account.server), Modifier.fillMaxSize()) {
                        Box(Modifier.fillMaxSize().background(if (sel) Palette.accent else Palette.raised), contentAlignment = Alignment.Center) {
                            Text(initials(ws.name, 3), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        }
                    }
                }
            }
        }
        item {
            RailItem("Add a server", selected = false, onClick = onAdd) {
                Box(Modifier.fillMaxSize().background(Palette.raised), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Add, contentDescription = null, tint = Palette.green, modifier = Modifier.size(26.dp))
                }
            }
        }
    }
}

/** A rail icon: a rounded square with a white pill beside it when selected. */
@Composable
private fun RailItem(label: String, selected: Boolean, badge: Int = 0, onClick: () -> Unit, content: @Composable (Boolean) -> Unit) {
    val pill by animateDpAsState(if (selected) 40.dp else 0.dp, spring(), label = "pill")
    val corner by animateDpAsState(if (selected) 16.dp else 18.dp, label = "corner")
    Box(Modifier.fillMaxWidth().height(50.dp)) {
        Box(Modifier.align(Alignment.CenterStart).width(4.dp).height(pill).background(Palette.heading, RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)))
        Box(
            Modifier.align(Alignment.Center).size(50.dp)
                .semantics { contentDescription = label; this.selected = selected }
                .clickable(onClick = onClick),
        ) {
            Box(Modifier.fillMaxSize().clip(RoundedCornerShape(corner))) { content(selected) }
            CountBadge(badge, Modifier.align(Alignment.BottomEnd).offset(6.dp, 6.dp))
        }
    }
}

// Profile pill

@Composable
private fun ProfilePill(account: Account, modifier: Modifier, onOpen: () -> Unit, onBell: () -> Unit) {
    Row(
        modifier.fillMaxWidth()
            .shadow(12.dp, RoundedCornerShape(22.dp))
            .background(Palette.field, RoundedCornerShape(22.dp))
            .border(0.5.dp, Palette.raised.copy(alpha = 0.6f), RoundedCornerShape(22.dp))
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).clickable(onClickLabel = "Accounts and settings", onClick = onOpen),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box {
                account.me?.let { Avatar(it.summary, 44.dp, account.api) } ?: Box(Modifier.size(44.dp).background(Palette.raised, CircleShape))
                Box(Modifier.align(Alignment.BottomEnd).offset(2.dp, 2.dp).size(16.dp).background(Palette.field, CircleShape).padding(3.dp).background(Palette.green, CircleShape))
            }
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(account.me?.displayName ?: " ", color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1)
                    Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = Palette.muted, modifier = Modifier.size(18.dp))
                }
                Text("Online", color = Palette.muted, fontSize = 12.sp)
            }
        }
        Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = "Notification settings", onClick = onBell), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Notifications, contentDescription = "Notification settings", tint = Palette.muted)
        }
    }
}

// Channel list

@Composable
private fun ChannelListPanel(
    server: String,
    workspace: WorkspaceSummary,
    detail: WorkspaceDetail?,
    error: String?,
    selectedChannel: String?,
    api: ApiClient?,
    onSignedOut: () -> Unit,
    open: (Channel) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val collapsed = remember(workspace.id) { mutableStateListOf<String>() }
    var searching by remember { mutableStateOf(false) }
    var voiceAlert by remember { mutableStateOf(false) }

    val sections = remember(detail) {
        if (detail == null) emptyList() else {
            val visible = detail.channels.filter { it.isText || it.isVoice }.sortedBy { it.position }
            buildList {
                visible.filter { it.categoryId == null }.takeIf { it.isNotEmpty() }?.let { add(Triple("", "", it)) }
                for (c in detail.categories.sortedBy { it.position }) {
                    visible.filter { it.categoryId == c.id }.takeIf { it.isNotEmpty() }?.let { add(Triple(c.id, c.name, it)) }
                }
            }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 16.dp, bottom = 110.dp)) {
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Row(
                    Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "Workspace settings") { openInBrowser(context, "$server/w/${workspace.id}/settings") },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(workspace.name, color = Palette.heading, fontWeight = FontWeight.Bold, fontSize = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = Palette.muted)
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.field).clickable { searching = true },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(Icons.Filled.Search, contentDescription = null, tint = Palette.text, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Search", color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    }
                    SquareButton(Icons.Filled.PersonAddAlt1, "Invite people") {
                        scope.launch {
                            try {
                                val invite = api!!.send<Invite>("/api/workspaces/${workspace.id}/invites", "POST", buildJsonObject { })
                                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, invite.url), "Invite to ${workspace.name}"))
                            } catch (e: chat.beacon.android.net.ApiException.SignedOut) {
                                onSignedOut()
                            } catch (e: Exception) {
                                openInBrowser(context, "$server/w/${workspace.id}")
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                Divider()
            }
        }
        if (detail == null) {
            item {
                if (error != null) Text(error, color = Palette.danger, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
                else Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.muted) }
            }
        }
        for ((id, title, channels) in sections) {
            if (title.isNotEmpty()) {
                item(key = "cat-$id") {
                    val isCollapsed = id in collapsed
                    Row(
                        Modifier.fillMaxWidth().clickable { if (isCollapsed) collapsed.remove(id) else collapsed.add(id) }
                            .padding(start = 16.dp, end = 16.dp, top = 22.dp, bottom = 6.dp)
                            .semantics { heading() },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(title, color = Palette.muted, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Icon(Icons.Filled.ExpandMore, contentDescription = if (isCollapsed) "Expand" else "Collapse", tint = Palette.muted, modifier = Modifier.size(18.dp).rotate(if (isCollapsed) -90f else 0f))
                    }
                }
            }
            // A collapsed category still shows its unread channels, as on Discord.
            items(channels.filter { id !in collapsed || it.isUnread || it.id == selectedChannel }, key = { it.id }) { channel ->
                ChannelRow(channel, selected = channel.id == selectedChannel) { if (channel.isVoice) voiceAlert = true else open(channel) }
            }
        }
    }

    if (searching && api != null) SearchSheet(api, workspace, onDismiss = { searching = false }) { result ->
        searching = false
        open(Channel(result.message.channelId, null, result.channelName, "text", 0, 0, 0, 0))
    }
    if (voiceAlert) {
        AlertDialog(
            onDismissRequest = { voiceAlert = false },
            title = { Text("Voice isn't in the app yet") },
            text = { Text("Join voice channels from Chat on the web or the desktop app for now.") },
            confirmButton = { TextButton(onClick = { voiceAlert = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { voiceAlert = false; openInBrowser(context, "$server/w/${workspace.id}") }) { Text("Open in browser") } },
            containerColor = Palette.panel,
        )
    }
}

@Composable
private fun SquareButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(width = 44.dp, height = 40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.field).clickable(onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = label, tint = Palette.heading, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun ChannelRow(channel: Channel, selected: Boolean, onClick: () -> Unit) {
    val bright = selected || channel.isUnread
    Box(Modifier.fillMaxWidth()) {
        if (channel.isUnread && !selected) {
            Box(Modifier.align(Alignment.CenterStart).width(4.dp).height(8.dp).background(Palette.heading, RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)))
        }
        Row(
            Modifier.padding(horizontal = 8.dp).fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
                .background(if (selected) Palette.hover else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp)
                .semantics(mergeDescendants = true) {},
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(if (channel.isVoice) Icons.AutoMirrored.Filled.VolumeUp else Icons.Filled.Tag, contentDescription = if (channel.isVoice) "Voice channel" else null, tint = if (bright) Palette.heading else Palette.faint, modifier = Modifier.size(20.dp))
            Text(channel.name, color = if (bright) Palette.heading else Palette.muted, fontSize = 17.sp, fontWeight = if (bright) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            CountBadge(channel.mentionCount, ring = Color.Transparent)
        }
    }
}

// Direct messages

@Composable
private fun DirectMessagesPanel(items: List<AccountDm>, loaded: Boolean, state: AppState, open: (AccountDm) -> Unit) {
    var newMessage by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf("") }
    val shown = if (filter.isBlank()) items else items.filter { it.dm.peer.displayName.contains(filter.trim(), true) || it.dm.peer.username.contains(filter.trim(), true) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 24.dp, bottom = 110.dp)) {
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text("Messages", color = Palette.heading, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (searching) {
                        Row(Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.field).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Search, contentDescription = null, tint = Palette.muted, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            BasicTextField(filter, { filter = it }, singleLine = true, textStyle = TextStyle(color = Palette.heading, fontSize = 16.sp), cursorBrush = SolidColor(Palette.accent), modifier = Modifier.weight(1f), decorationBox = { inner ->
                                if (filter.isEmpty()) Text("Find a conversation", color = Palette.faint, fontSize = 16.sp)
                                inner()
                            })
                            Icon(Icons.Filled.Close, contentDescription = "Close search", tint = Palette.muted, modifier = Modifier.size(18.dp).clickable { filter = ""; searching = false })
                        }
                    } else {
                        SquareButton(Icons.Filled.Search, "Find a conversation") { searching = true }
                        Row(
                            Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.field).clickable { newMessage = true },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Icon(Icons.Filled.EditNote, contentDescription = null, tint = Palette.heading, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("New Message", color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
            }
        }
        if (!loaded) {
            item { Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.muted) } }
        } else if (items.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.ChatBubble, contentDescription = null, tint = Palette.faint, modifier = Modifier.size(40.dp))
                    Text("No messages yet", color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    Text("Start a conversation with someone from one of your workspaces.", color = Palette.muted, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
            }
        }
        items(shown, key = { it.key }) { item -> DmRow(item, state.account(item.server)?.me, state.api(item.server)) { open(item) } }
    }

    if (newMessage) NewMessageSheet(state, onDismiss = { newMessage = false }) { item ->
        newMessage = false
        open(item)
    }
}

@Composable
private fun DmRow(item: AccountDm, me: CurrentUser?, api: ApiClient?, onClick: () -> Unit) {
    val unread = item.dm.unreadCount > 0
    val preview = item.dm.lastMessage?.let { last ->
        val who = if (last.authorId == me?.id) "You" else item.dm.peer.displayName
        val text = if (last.content.isEmpty() && last.hasAttachments) "Sent an attachment" else last.content.replace('\n', ' ')
        "$who: $text"
    } ?: "@${item.dm.peer.username}"
    Row(
        Modifier.padding(horizontal = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 9.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(item.dm.peer, 48.dp, api)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(item.dm.peer.displayName, color = if (unread) Palette.heading else Palette.text, fontSize = 17.sp, fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                item.dm.lastMessageAt?.let { Text(ChatDate.relative(it), color = Palette.muted, fontSize = 12.sp) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(preview, color = if (unread) Palette.text else Palette.muted, fontSize = 15.sp, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                CountBadge(item.dm.unreadCount, ring = Color.Transparent)
            }
        }
    }
}

// Sheets

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchSheet(api: ApiClient, workspace: WorkspaceSummary, onDismiss: () -> Unit, open: (SearchResult) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun search() {
        if (query.isBlank()) return
        busy = true
        scope.launch {
            results = runCatching { api.get<SearchResponse>("/api/workspaces/${workspace.id}/search?q=${URLEncoder.encode(query.trim(), "UTF-8")}").results }.getOrDefault(emptyList())
            busy = false
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.chat) {
        Column(Modifier.fillMaxWidth().heightIn(min = 500.dp).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(12.dp)).background(Palette.field).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Search, contentDescription = null, tint = Palette.muted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(color = Palette.heading, fontSize = 16.sp), cursorBrush = SolidColor(Palette.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { search() }), modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text("Search ${workspace.name}", color = Palette.faint, fontSize = 16.sp)
                        inner()
                    })
            }
            Spacer(Modifier.height(12.dp))
            when {
                busy -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.muted) }
                results?.isEmpty() == true -> Text("No messages match “$query”.", color = Palette.muted, modifier = Modifier.padding(24.dp).fillMaxWidth(), textAlign = TextAlign.Center)
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(results.orEmpty(), key = { it.message.id }) { r ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.panel).clickable { open(r) }.padding(12.dp)) {
                        Text("#${r.channelName}", color = Palette.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Avatar(r.message.author.summary, 32.dp, api)
                            Column {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(r.message.author.name, color = Palette.heading, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                    Text(ChatDate.label(r.message.createdAt), color = Palette.faint, fontSize = 11.sp)
                                }
                                Text(r.message.content, color = Palette.text, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Pick someone to message, from any of your servers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewMessageSheet(state: AppState, onDismiss: () -> Unit, open: (AccountDm) -> Unit) {
    var query by remember { mutableStateOf("") }
    var people by remember { mutableStateOf<List<Pair<String, UserSummary>>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query) {
        delay(250)
        val q = URLEncoder.encode(query, "UTF-8")
        people = state.accounts.value.flatMap { a -> runCatching { a.api.get<List<UserSummary>>("/api/dms/people?q=$q") }.getOrDefault(emptyList()).map { a.server to it } }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.panel) {
        Column(Modifier.fillMaxWidth().heightIn(min = 500.dp).padding(horizontal = 16.dp)) {
            Text("New Message", color = Palette.heading, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
            Spacer(Modifier.height(12.dp))
            FilledField(query, { query = it }, placeholder = "Who do you want to message?", autoFocus = true)
            error?.let { Text(it, color = Palette.danger, modifier = Modifier.padding(top = 8.dp)) }
            LazyColumn(contentPadding = PaddingValues(vertical = 12.dp)) {
                items(people, key = { "${it.first}|${it.second.id}" }) { (server, user) ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable {
                            scope.launch {
                                try {
                                    val api = state.api(server)!!
                                    val opened = api.send<OpenedDm>("/api/dms", "POST", buildJsonObject { put("userId", user.id) })
                                    open(AccountDm(server, chat.beacon.android.net.DirectMessage(opened.workspaceId, opened.channelId, user, null, 0, null)))
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(user, 36.dp, state.api(server))
                        Column {
                            Text(user.displayName, color = Palette.heading, fontSize = 16.sp)
                            Text("@${user.username}", color = Palette.muted, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

/** Opened from the profile pill: your account on each server, and settings. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileSheet(state: AppState, selected: String?, onDismiss: () -> Unit, onAddServer: () -> Unit) {
    val accounts by state.accounts.collectAsState()
    val context = LocalContext.current
    var confirm by remember { mutableStateOf<Account?>(null) }
    val account = accounts.firstOrNull { it.server == selected } ?: accounts.firstOrNull()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.rail) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            account?.me?.let { me ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.panel)) {
                    Box(Modifier.fillMaxWidth().height(80.dp).background(Palette.accent))
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.offset(y = (-46).dp).size(86.dp).background(Palette.panel, CircleShape).padding(5.dp)) { Avatar(me.summary, 76.dp, account.api) }
                        Column(Modifier.offset(y = (-46).dp)) {
                            Text(me.displayName, color = Palette.heading, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            Text("@${me.username}", color = Palette.text, fontSize = 15.sp)
                            Spacer(Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Box(Modifier.weight(1f)) {
                                    androidx.compose.material3.Button(onClick = { openInBrowser(context, "${account.server}/settings") }, colors = primaryButtonColors, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().height(48.dp)) {
                                        Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Text("Edit Profile", fontWeight = FontWeight.SemiBold)
                                    }
                                }
                                SquareButton(Icons.Filled.Settings, "Settings") { openInBrowser(context, "${account.server}/settings/notifications") }
                            }
                        }
                    }
                }
            }
            Text("YOUR ACCOUNTS", color = Palette.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.panel)) {
                accounts.forEach { a ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        a.me?.let { Avatar(it.summary, 36.dp, a.api) }
                        Column(Modifier.weight(1f)) {
                            Text(a.me?.displayName ?: "", color = Palette.heading)
                            Text(a.me?.let { "@${it.username}" } ?: "", color = Palette.muted, fontSize = 12.sp)
                        }
                        TextButton(onClick = { confirm = a }) { Text("Log Out", color = Palette.danger) }
                    }
                    Divider(Modifier.padding(start = 64.dp), Palette.raised)
                }
                Row(Modifier.fillMaxWidth().clickable(onClick = onAddServer).heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Filled.Add, contentDescription = null, tint = Palette.green)
                    Text("Add a server", color = Palette.heading)
                }
            }
        }
    }
    confirm?.let { a ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("Log out?") },
            text = { Text("You'll need to sign in to ${a.host} again to see its workspaces.") },
            confirmButton = { TextButton(onClick = { state.signOut(a.server); confirm = null }) { Text("Log Out", color = Palette.danger) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
            containerColor = Palette.panel,
        )
    }
}
